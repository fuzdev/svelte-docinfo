/**
 * Module-level export analysis: resolve every export of a TypeScript source
 * file into a `DeclarationAnalysis`, including re-export classification.
 *
 * Builds on the per-declaration extractors in `typescript-extract-*.ts` by
 * adding the orchestration layer — alias chain walking, namespace
 * classification, JSDoc routing for re-exports, default-slot handling.
 *
 * @see `typescript-program.ts` for `IsExternalFile` and program construction
 * @see `typescript-extract-*.ts` for the per-declaration extractors
 *
 * @module
 */

import { dirname, resolve } from 'node:path';
import ts from 'typescript';

import type {
	DeclarationAnalysis,
	ModuleAnalysis,
	ModuleExportsAnalysis,
	DeclarationJsonBuild
} from './declaration-build.ts';
import type { ReExportJsonInput, ExternalReExportJsonInput } from './types.ts';
import type { Diagnostic } from './diagnostics.ts';
import { parseComment, applyToDeclaration, cleanComment, hasDocContent } from './tsdoc.ts';
import {
	type SourceFileInfo,
	isSvelte2tsxGeneratedExport,
	isSvelteVirtualPath,
	stripVirtualSuffix,
	getComponentName
} from './source.ts';
import { type ModuleSourceOptions, extractDependencies, extractPath } from './source-config.ts';
import { createIsExternalPath } from './typescript-program.ts';
import { toPosixPath } from './paths.ts';
import {
	getLocalExportStatement,
	getNodeLocation,
	inferDeclarationKind,
	isDeclaredInFile,
	selectDeclarationNode,
	type ExtractContext,
	type IsEmittedFile
} from './typescript-extract-shared.ts';
import {
	isAliasLostType,
	isBrandLikeIntersection,
	isLiteralOnlyUnion
} from './typescript-extract-type-json.ts';
import { extractFunctionInfo, extractVariableInfo } from './typescript-extract-function.ts';
import { extractTypeInfo, extractEnumInfo } from './typescript-extract-type.ts';
import { extractClassInfo } from './typescript-extract-class.ts';

/**
 * Analyze a TypeScript file and extract module metadata.
 *
 * The TypeScript arm of `analyzeModule`: wraps `analyzeExports` and adds
 * dependency information via `extractDependencies`. For whole-project analysis
 * use `analyze`/`analyzeFromFiles`.
 *
 * @param sourceFileInfo - the source file info (from file system, build pipeline, or other source)
 * @param tsSourceFile - TypeScript source file from the program
 * @param modulePath - the module path (relative to source root)
 * @param ctx - the extraction pass's context (see `analyzeExports` for the construction contract)
 * @param options - module source options for path extraction
 * @returns module metadata and re-export information
 */
export const analyzeTypescriptModule = (
	sourceFileInfo: SourceFileInfo & { dependents?: ReadonlyArray<string> },
	tsSourceFile: ts.SourceFile,
	modulePath: string,
	ctx: ExtractContext,
	options: ModuleSourceOptions
): ModuleAnalysis => {
	// Use the mid-level helper for core analysis
	const {
		moduleComment,
		declarations,
		reExports,
		starExports,
		externalReExports,
		externalStarExports
	} = analyzeExports(tsSourceFile, ctx, options);

	// Extract dependencies and dependents if provided
	const { dependencies, dependents } = extractDependencies(sourceFileInfo, options);

	return {
		path: modulePath,
		moduleComment,
		declarations,
		dependencies,
		dependents,
		starExports,
		reExports,
		externalReExports,
		externalStarExports
	};
};

/**
 * Walk the immediate-alias chain while names match, returning the deepest
 * symbol whose name still equals `exportSymbol.name`. Used by both the
 * namespace classifier and the standard alias path in `analyzeExports` to
 * locate the canonical-for-this-name (which may be an upstream alias
 * declaration, not the deeply-resolved root — relevant when a chain renames
 * partway through).
 *
 * `getImmediateAliasedSymbol` asserts on non-alias symbols, so the walk also
 * stops when the chain reaches a real declaration.
 */
const walkSameNameCanonical = (
	exportSymbol: ts.Symbol,
	immediateAlias: ts.Symbol | undefined,
	checker: ts.TypeChecker
): ts.Symbol => {
	let canonical: ts.Symbol = exportSymbol;
	let next: ts.Symbol | undefined = immediateAlias;
	while (next && next.name === exportSymbol.name) {
		canonical = next;
		next =
			(next.flags & ts.SymbolFlags.Alias) !== 0
				? checker.getImmediateAliasedSymbol(next)
				: undefined;
	}
	return canonical;
};

/**
 * Classification of a namespace re-export — `export * as ns from './x'` and
 * forwarding re-exports of such bindings.
 *
 * Three shapes:
 * - **origination** — this file declares the namespace via `export * as ns from './x'`.
 * - **same-name** — this file forwards an existing namespace by the same name
 *   (`export {ns} from './has-namespace'`, or N-hop chains of such specifiers
 *   where names match). Linked via `alsoExportedFrom`.
 * - **renamed** — this file forwards a namespace under a different name
 *   (`export {ns as foo} from './has-namespace'`). Synthesized alias declaration
 *   with `aliasOf` pointing at the canonical.
 *
 * Star-projected namespace bindings (`export * from` a module whose export
 * table contains `ns`) never reach classification when the star's target
 * emits a module — the caller's locality skip filters them first, and
 * `starExports` is their sole encoding like every other star-projected
 * binding. Over a target that emits nothing they classify as same-name.
 */
type NamespaceClassification =
	| { kind: 'origination'; sourceModule: string }
	| {
			kind: 'same-name';
			canonicalModule: string;
			sourceModule: string;
			/**
			 * The canonical's file is project-local but gated from output
			 * (`internal/` convention, user excludes) — there is no canonical
			 * declaration to link, so the caller synthesizes the alias
			 * unconditionally and skips the `reExports` edge.
			 */
			canonicalGated: boolean;
	  }
	| {
			kind: 'renamed';
			namespaceDefiningFile: string;
			sourceModule: string;
			canonicalName: string;
	  };

/**
 * Classify a namespace re-export, robust to arbitrary alias-chain depth.
 *
 * Detection uses the `ValueModule` flag on the deeply-resolved alias —
 * `getImmediateAliasedSymbol` is fragile because intermediate hops are
 * `ExportSpecifier` nodes, not `NamespaceExport`, so a chain like
 * `c.ts: export {ns as foo} from './b'` → `b.ts: export {ns} from './a'` →
 * `a.ts: export * as ns from './x'` defeats immediate-alias detection.
 *
 * Returns `null` for non-namespace re-exports (regular declarations and
 * external-module re-exports), letting the caller fall through to the
 * standard alias-handling path.
 */
const classifyNamespaceReExport = (
	exportSymbol: ts.Symbol,
	checker: ts.TypeChecker,
	currentFileName: string,
	options: ModuleSourceOptions,
	isExternalPath: (file: string) => boolean,
	isEmittedFile: IsEmittedFile,
	starProjected: boolean
): NamespaceClassification | null => {
	const deeplyAliased = checker.getAliasedSymbol(exportSymbol);
	if ((deeplyAliased.flags & ts.SymbolFlags.ValueModule) === 0) return null;

	// Source module = where the deeply-resolved module symbol lives. The gate
	// is externality, not `isSource` — a project-local gated module (the
	// `internal/` convention) still classifies, so `export * as ns from
	// './internal/x.ts'` documents as a namespace instead of falling through
	// to the external arm with a relative path as its "package" specifier.
	// Truly external targets (`export * as ns from 'pkg'`) return null and
	// take the external arm.
	const sourceModuleFile = getPrimaryDeclarationFile(deeplyAliased);
	if (!sourceModuleFile || isExternalPath(sourceModuleFile)) return null;

	// Origination: export's first declaration is itself a NamespaceExport in
	// this file. The caller's locality skip filters star-projected bindings
	// before classification, but merged symbols could put a foreign
	// declaration first — bail rather than misclassify. The one foreign
	// NamespaceExport that does classify is a binding materialized from a
	// star (see `collectMaterializedStars`): this module forwards the
	// namespace under its own name, which is the same-name shape, with the
	// defining file as canonical.
	const exportDecl = exportSymbol.declarations?.[0];
	if (exportDecl && ts.isNamespaceExport(exportDecl)) {
		const definingFile = stripVirtualSuffix(exportDecl.getSourceFile().fileName);
		if (definingFile !== currentFileName) {
			if (!starProjected || isExternalPath(definingFile)) return null;
			return {
				kind: 'same-name',
				canonicalModule: extractPath(definingFile, options),
				sourceModule: extractPath(sourceModuleFile, options),
				canonicalGated: !isEmittedFile(definingFile)
			};
		}
		return { kind: 'origination', sourceModule: extractPath(sourceModuleFile, options) };
	}

	// Re-export specifier (`export {ns ...} from`). Use immediate-alias name
	// comparison for rename detection — this matches the existing non-namespace
	// rename semantics and stays correct for chains.
	const immediateAlias = checker.getImmediateAliasedSymbol(exportSymbol);
	if (!immediateAlias) return null;

	if (exportSymbol.name !== immediateAlias.name) {
		// Renamed: walk forward until we hit the canonical NamespaceExport.
		// That's the namespace-defining file (where the binding originates).
		let cursor: ts.Symbol | undefined = immediateAlias;
		let namespaceDefiningFile: string | undefined;
		let canonicalName: string | undefined;
		while (cursor) {
			const decl = cursor.declarations?.[0];
			if (decl && ts.isNamespaceExport(decl)) {
				namespaceDefiningFile = stripVirtualSuffix(decl.getSourceFile().fileName);
				canonicalName = cursor.name;
				break;
			}
			cursor =
				(cursor.flags & ts.SymbolFlags.Alias) !== 0
					? checker.getImmediateAliasedSymbol(cursor)
					: undefined;
		}
		if (!namespaceDefiningFile || !canonicalName) return null;
		if (isExternalPath(namespaceDefiningFile)) return null;
		return {
			kind: 'renamed',
			namespaceDefiningFile: extractPath(namespaceDefiningFile, options),
			sourceModule: extractPath(sourceModuleFile, options),
			canonicalName
		};
	}

	// Same-name: the canonical-for-this-name may be an upstream renamed alias
	// declaration, not the original NamespaceExport.
	const canonical = walkSameNameCanonical(exportSymbol, immediateAlias, checker);
	const canonicalDecl = canonical.declarations?.[0];
	if (!canonicalDecl) return null;
	const canonicalFile = stripVirtualSuffix(canonicalDecl.getSourceFile().fileName);
	if (canonicalFile === currentFileName) return null;
	if (isExternalPath(canonicalFile)) return null;
	return {
		kind: 'same-name',
		canonicalModule: extractPath(canonicalFile, options),
		sourceModule: extractPath(sourceModuleFile, options),
		canonicalGated: !isEmittedFile(canonicalFile)
	};
};

/**
 * The source file of a symbol's primary declaration (`valueDeclaration`,
 * else the first declaration), or `undefined` for declaration-less symbols.
 *
 * Resolves which file "owns" a symbol for canonical-module attribution.
 * Distinct from `isDeclaredInFile`, which asks whether *any* declaration
 * lives in a given file — the right question for ownership tests on
 * potentially-merged symbols.
 */
const getPrimaryDeclarationSourceFile = (symbol: ts.Symbol): ts.SourceFile | undefined =>
	(symbol.valueDeclaration ?? symbol.declarations?.[0])?.getSourceFile();

/**
 * The virtual-suffix-normalized file name of a symbol's primary declaration,
 * or `undefined` for declaration-less symbols. String form of
 * `getPrimaryDeclarationSourceFile` for callers that only compare paths.
 */
const getPrimaryDeclarationFile = (symbol: ts.Symbol): string | undefined => {
	const source = getPrimaryDeclarationSourceFile(symbol);
	return source && stripVirtualSuffix(source.fileName);
};

/**
 * Whether a local export statement/specifier pair is type-only — either
 * statement-level (`export type {…} from`) or specifier-level
 * (`export {type A} from`). Type-only names are erased at runtime.
 */
const isTypeOnlyLocalExport = (local: {
	node: ts.ExportSpecifier | ts.NamespaceExport;
	statement: ts.ExportDeclaration;
}): boolean =>
	local.statement.isTypeOnly || (ts.isExportSpecifier(local.node) && local.node.isTypeOnly);

/**
 * Public name for a cross-file re-export: `default` re-keys to the
 * component's filename-derived name when the canonical is a Svelte component
 * (its declarations live in the svelte2tsx virtual), matching how the
 * canonical documents — every other name passes through.
 */
const reExportPublicName = (
	exportName: string,
	canonicalVirtualFileName: string | undefined,
	canonicalFile: string
): string =>
	exportName === 'default' &&
	canonicalVirtualFileName !== undefined &&
	isSvelteVirtualPath(canonicalVirtualFileName)
		? getComponentName(canonicalFile)
		: exportName;

/**
 * The project file a re-export names when its component has no svelte2tsx
 * virtual in the program — its transform failed, or it was never supplied
 * (the context closure off) — or `undefined` for any other re-export.
 *
 * With no virtual to resolve to, a `.svelte` specifier falls through to the
 * `svelte` package's ambient `declare module '*.svelte'`, loaded as soon as
 * any file imports `svelte`. Its default export is a real symbol in an
 * external file, so the re-export would read as one from a package. Detected
 * by that landing spot plus a relative `.svelte` specifier on the statement;
 * the path is the specifier resolved against the re-exporting file.
 *
 * Limits: it sees nothing until some file in the program imports `svelte`
 * (no ambient module yet, so the name documents as a bare `variable`); an
 * import-then-export has no specifier on the export statement and is not
 * caught; and the file isn't checked for existence, so a mistyped path reads
 * the same as a failed component.
 */
const virtuallessSvelteTarget = (
	statement: ts.ExportDeclaration,
	aliasedSymbol: ts.Symbol,
	currentFileName: string
): string | undefined => {
	const specifier = statement.moduleSpecifier;
	if (!specifier || !ts.isStringLiteral(specifier)) return undefined;
	if (!specifier.text.startsWith('.') || !specifier.text.endsWith('.svelte')) return undefined;
	// a declaration *inside* the ambient module: its default export, not the
	// module itself (which is what `export * as ns` resolves to)
	let node: ts.Node | undefined = aliasedSymbol.declarations?.[0];
	if (!node || ts.isModuleDeclaration(node)) return undefined;
	while (node && !ts.isModuleDeclaration(node)) node = node.parent;
	if (!node || !ts.isStringLiteral(node.name) || node.name.text !== '*.svelte') return undefined;
	return toPosixPath(resolve(dirname(currentFileName), specifier.text));
};

/** Whether `symbol` is what `sourceFile` exports as `default`, through any alias. */
const isDefaultExportOf = (
	symbol: ts.Symbol,
	sourceFile: ts.SourceFile,
	checker: ts.TypeChecker
): boolean => {
	const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
	const defaultExport =
		moduleSymbol && checker.tryGetMemberInModuleExports('default', moduleSymbol);
	if (!defaultExport) return false;
	const resolved =
		defaultExport.flags & ts.SymbolFlags.Alias
			? checker.getAliasedSymbol(defaultExport)
			: defaultExport;
	return resolved === symbol || defaultExport === symbol;
};

/**
 * Synthesize a cross-file alias declaration for a renamed or documented
 * same-name re-export.
 *
 * A Svelte component — the default export of a svelte2tsx virtual — gets a
 * `kind: 'component'` placeholder: running `analyzeDeclaration` on
 * svelte2tsx's `__SvelteComponent_` type alias would leak internal names;
 * phase-2 `resolveComponentAliases` copies props/acceptsChildren/lang/etc.
 * from the canonical (fill-gaps-only, so local JSDoc applied by the caller
 * sticks). Everything else, a component's `<script module>` exports included,
 * is analyzed in its own source file so the alias inherits `typeSignature`,
 * `reactivity`, `docComment`, `parameters`, etc.
 *
 * `aliasOf.name` is the canonical's own symbol name — `'default'` for
 * default-slot canonicals (renames into and out of the slot flow through
 * uniformly), the filename-derived component name for Svelte. `sourceLine`
 * is the local export specifier's line, not the canonical's location.
 */
const synthesizeCrossFileAlias = (
	publicName: string,
	aliasedSymbol: ts.Symbol,
	originalSource: ts.SourceFile,
	originalModule: string,
	specifierLine: number | undefined,
	ctx: ExtractContext
): DeclarationJsonBuild => {
	if (
		isSvelteVirtualPath(originalSource.fileName) &&
		isDefaultExportOf(aliasedSymbol, originalSource, ctx.checker)
	) {
		return {
			name: publicName,
			kind: 'component',
			aliasOf: { module: originalModule, name: getComponentName(originalModule) },
			sourceLine: specifierLine
		};
	}
	const { declaration: analyzed } = analyzeDeclaration(aliasedSymbol, originalSource, ctx);
	const canonicalName = analyzed.name!;
	analyzed.name = publicName;
	analyzed.aliasOf = { module: originalModule, name: canonicalName };
	analyzed.sourceLine = specifierLine;
	return analyzed;
};

/** The symbol an export binding ultimately names: an alias's target, else the symbol itself. */
const resolveAlias = (symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol =>
	symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;

/** A star-projected binding to document, as `collectMaterializedStars` resolved it. */
interface MaterializedStar {
	/** The `export * from` statement the binding is documented under. */
	statement: ts.ExportDeclaration;
	/** The binding the name resolves to through that star. */
	resolved: ts.Symbol;
}

/**
 * The bindings a module publishes only through `export * from` a project file
 * that emits no module (gated, or outside the analyzed inputs), keyed by name
 * with the star statement that projects each.
 *
 * `starExports` can't carry these: the target isn't in the output, so the
 * names would be documented nowhere. The caller instead treats each as the
 * named same-name re-export the star stands for, which routes it through the
 * ordinary re-export arms — a link when its canonical does emit, a
 * synthesized alias when it doesn't.
 *
 * ES star semantics decide membership, not TypeScript's export table (which
 * keeps the first of two conflicting stars): `default` never projects, a
 * local export of the same name shadows, and a name two stars resolve to
 * different bindings is ambiguous and excluded. A name an emitted star target
 * also provides is left to that target's `starExports` entry.
 * svelte2tsx-generated names are skipped, and a statement-level `@nodocs`
 * suppresses the whole star, as it does for an emitted target — its bindings
 * still count toward ambiguity, since the module exports them all the same.
 *
 * Each entry carries the binding the star resolves the name to; the caller
 * checks the export table's symbol against it, so a symbol the table took
 * from some other star is never documented under this one.
 *
 * Not reconciled: a name an emitted star and a non-emitted star resolve
 * differently is ambiguous under ES, but stays with the emitted star's
 * `starExports` entry, which can't exclude a single name.
 */
const collectMaterializedStars = (
	sourceFile: ts.SourceFile,
	localExports: ReadonlyArray<ts.Symbol>,
	currentFileName: string,
	checker: ts.TypeChecker,
	isExternalPath: (file: string) => boolean,
	isEmittedFile: IsEmittedFile
): Map<string, MaterializedStar> => {
	// every star's projected bindings, by name, with whether its target emits
	// and whether the statement is `@nodocs`
	interface Provider extends MaterializedStar {
		emitted: boolean;
		suppressed: boolean;
	}
	const providers = new Map<string, Array<Provider>>();
	let anyMaterialized = false;
	for (const statement of sourceFile.statements) {
		if (
			!ts.isExportDeclaration(statement) ||
			statement.exportClause ||
			!statement.moduleSpecifier ||
			!ts.isStringLiteral(statement.moduleSpecifier)
		) {
			continue;
		}
		const suppressed = !!parseComment(statement, sourceFile)?.nodocs;
		const moduleSymbol = checker.getSymbolAtLocation(statement.moduleSpecifier);
		const targetFile = moduleSymbol && getPrimaryDeclarationFile(moduleSymbol);
		if (!moduleSymbol || !targetFile || isExternalPath(targetFile)) continue;
		const emitted = isEmittedFile(targetFile);
		if (!emitted && !suppressed) anyMaterialized = true;
		for (const projected of checker.getExportsOfModule(moduleSymbol)) {
			if (projected.name === 'default' || isSvelte2tsxGeneratedExport(projected.name)) continue;
			let list = providers.get(projected.name);
			if (!list) providers.set(projected.name, (list = []));
			list.push({
				statement,
				resolved: resolveAlias(projected, checker),
				emitted,
				suppressed
			});
		}
	}

	const materialized = new Map<string, MaterializedStar>();
	if (!anyMaterialized) return materialized;
	const shadowed = new Set<string>();
	for (const symbol of localExports) {
		if (isDeclaredInFile(symbol, currentFileName)) shadowed.add(symbol.name);
	}
	for (const [name, list] of providers) {
		if (shadowed.has(name)) continue;
		if (list.some((p) => p.emitted)) continue;
		if (list.some((p) => p.resolved !== list[0]!.resolved)) continue;
		const provider = list.find((p) => !p.suppressed);
		if (provider) {
			materialized.set(name, { statement: provider.statement, resolved: provider.resolved });
		}
	}
	return materialized;
};

/**
 * Analyze all exports from a TypeScript source file.
 *
 * Extracts the module-level comment via `extractModuleComment` (skipped for
 * svelte2tsx virtual files — see the inline note), star exports via
 * `extractStarExports`, and all exported declarations with complete metadata.
 * Handles re-exports by:
 * - Same-name re-exports: tracked in `reExports` for `alsoExportedFrom` building
 * - Renamed re-exports: included as new declarations with `aliasOf` metadata
 * - Star exports (`export * from`): tracked in `starExports` for namespace-level info
 * - Direct external re-exports: tracked in `externalReExports`/`externalStarExports`
 *   (specifier as written; import-then-export and source-chained forms stay silent)
 *
 * This is a mid-level function (above the individual `extract*` helpers, below `analyze`)
 * suitable for building documentation, API explorers, or analysis tools.
 * For standard SvelteKit library layouts, use `createSourceOptions(process.cwd())`.
 *
 * @param sourceFile - the TypeScript source file to analyze
 * @param ctx - the extraction pass's context (see `createExtractContext`); its
 *   `isExternalFile` must derive from the same `options` passed here, since this
 *   function derives its path-keyed twin (`createIsExternalPath`) from `options`
 *   and the two must agree
 * @param options - module source options for path extraction in re-exports
 * @returns module comment, declarations, re-exports (source + external), and star exports (source + external)
 */
export const analyzeExports = (
	sourceFile: ts.SourceFile,
	ctx: ExtractContext,
	options: ModuleSourceOptions
): ModuleExportsAnalysis => {
	const { checker, diagnostics } = ctx;
	const declarations: Array<DeclarationAnalysis> = [];
	const reExports: Array<ReExportJsonInput> = [];
	const externalReExports: Array<ExternalReExportJsonInput> = [];

	// Externality by path, for the re-export arms and star extraction below.
	// Not the same axis as `isSource`: a project-local file can be gated from
	// output (`internal/` convention, user excludes) without being external —
	// its re-exports synthesize here instead of masquerading as
	// external-package facts.
	const isExternalPath = createIsExternalPath(options);

	// Extract star exports (export * from './module' / 'pkg')
	const { starExports, externalStarExports } = extractStarExports(
		sourceFile,
		checker,
		options,
		isExternalPath,
		ctx.isEmittedFile
	);

	// Normalize virtual paths once (e.g., Foo.svelte.__svelte2tsx__.ts → Foo.svelte)
	// so re-export tracking matches real module paths
	const currentFileName = stripVirtualSuffix(sourceFile.fileName);

	// Extract module-level comment — skipped for svelte2tsx virtuals, where
	// hoisted instance-script comments would read as module comments;
	// `analyzeSvelteModule` extracts the `<script module>` comment from the
	// original source instead (and owns its `@nodocs` warning)
	const isVirtual = currentFileName !== sourceFile.fileName;
	const moduleComment = isVirtual ? undefined : extractModuleComment(sourceFile);

	warnModuleCommentNodocs(moduleComment, currentFileName, diagnostics);

	// 1-based line of a node in this file. Virtual coordinates for Svelte
	// `<script module>` sources — remapped in `analyzeSvelteModule`.
	const lineOf = (node: ts.Node): number =>
		sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

	// Get all exported symbols
	const symbol = checker.getSymbolAtLocation(sourceFile);
	if (symbol) {
		const exports = checker.getExportsOfModule(symbol);
		const materializedStars = collectMaterializedStars(
			sourceFile,
			exports,
			currentFileName,
			checker,
			isExternalPath,
			ctx.isEmittedFile
		);
		for (const exportSymbol of exports) {
			// Check if this is an alias (potential re-export) using the Alias flag
			const isAlias = (exportSymbol.flags & ts.SymbolFlags.Alias) !== 0;
			// The star statement to treat this binding as a named re-export
			// of, when it arrives only through a star over a module that
			// emits nothing (see `collectMaterializedStars`).
			const materialized = isDeclaredInFile(exportSymbol, currentFileName)
				? undefined
				: materializedStars.get(exportSymbol.name);
			const star =
				materialized && materialized.resolved === resolveAlias(exportSymbol, checker)
					? materialized.statement
					: undefined;

			if (isAlias || star) {
				// Star-projected alias bindings: `export * from './b'` projects
				// b.ts's own re-export bindings into this module's export table,
				// sharing the foreign declaration node (an `ExportSpecifier` or,
				// for `export * as ns`, a `NamespaceExport`). Same encoding rule
				// as star-projected value symbols below — `starExports` is the
				// sole encoding; processing the binding here would publish
				// re-export edges for statements this module's source doesn't
				// contain and read the foreign statement's JSDoc as if local
				// (synthesizing duplicate declarations with mis-attributed docs).
				// Runs before namespace classification so star-projected
				// namespace bindings are silenced uniformly. The exception is a
				// star over a module that emits nothing: there is no
				// `starExports` entry to carry the binding, so it is processed
				// as the named re-export the star stands for, positioned at the
				// star statement and never reading a foreign statement's JSDoc
				// (`getLocalExportStatement` finds none in this file).
				if (!star && !isDeclaredInFile(exportSymbol, currentFileName)) continue;
				const starLine = star ? lineOf(star) : undefined;

				// Namespace re-exports (`export * as ns from './x'` and re-exports
				// of such bindings) need special handling: their deeply-resolved
				// canonical is a module symbol, and `analyzeDeclaration` would fall
				// through to `kind: 'variable'` and produce a `typeof import("/abs/path")`
				// signature that leaks the publisher's filesystem path. Detection
				// uses the `ValueModule` flag on the deeply-resolved alias, which
				// is robust to arbitrary re-export chain depth (the immediate-alias
				// shape is fragile — intermediate hops are `ExportSpecifier` nodes,
				// not `NamespaceExport`).
				const nsClass = isAlias
					? classifyNamespaceReExport(
							exportSymbol,
							checker,
							currentFileName,
							options,
							isExternalPath,
							ctx.isEmittedFile,
							star !== undefined
						)
					: null;
				if (nsClass) {
					// The locality skip above filters star-projected bindings before
					// classification, so origination/renamed/same-name statements are
					// local; `getLocalExportStatement`'s identity check stays as
					// defense against merged symbols whose first declaration could be
					// a foreign node.
					const local = getLocalExportStatement(exportSymbol, sourceFile);
					const localTsdoc = local ? parseComment(local.statement, sourceFile) : undefined;
					const nsSpecifierLine = local ? lineOf(local.node) : starLine;

					if (nsClass.kind === 'origination') {
						const decl: DeclarationJsonBuild = {
							name: exportSymbol.name,
							kind: 'namespace',
							module: nsClass.sourceModule,
							sourceLine: nsSpecifierLine
						};
						if (localTsdoc) {
							applyToDeclaration(decl, localTsdoc);
						}
						declarations.push({ declaration: decl, nodocs: !!localTsdoc?.nodocs });
					} else if (nsClass.kind === 'renamed') {
						const decl: DeclarationJsonBuild = {
							name: exportSymbol.name,
							kind: 'namespace',
							module: nsClass.sourceModule,
							aliasOf: {
								module: nsClass.namespaceDefiningFile,
								name: nsClass.canonicalName
							},
							// Synthesized alias — the local export specifier's line,
							// not the canonical's location
							sourceLine: nsSpecifierLine
						};
						if (localTsdoc) {
							applyToDeclaration(decl, localTsdoc);
						}
						declarations.push({ declaration: decl, nodocs: !!localTsdoc?.nodocs });
					} else {
						// Same-name re-export — link via alsoExportedFrom on the canonical.
						// Position 3 (content-conditional synthesis): when the local
						// statement carries JSDoc or `@nodocs`, also synthesize a
						// `kind: 'namespace'` alias declaration so the local content
						// has somewhere to live (mirrors non-namespace same-name semantics
						// at the standard alias path). `@nodocs` suppresses both the
						// alias and the link. A *gated* canonical (project-local but
						// excluded from output) has no declaration to link, so the
						// alias synthesizes unconditionally and the edge is skipped —
						// this module owns the documentation.
						if (localTsdoc || nsClass.canonicalGated) {
							const decl: DeclarationJsonBuild = {
								name: exportSymbol.name,
								kind: 'namespace',
								module: nsClass.sourceModule,
								aliasOf: {
									module: nsClass.canonicalModule,
									name: exportSymbol.name
								},
								sourceLine: nsSpecifierLine
							};
							if (localTsdoc) {
								applyToDeclaration(decl, localTsdoc);
							}
							declarations.push({ declaration: decl, nodocs: !!localTsdoc?.nodocs });
						}
						if (!localTsdoc?.nodocs && !nsClass.canonicalGated) {
							reExports.push({
								name: exportSymbol.name,
								module: nsClass.canonicalModule,
								...(local && isTypeOnlyLocalExport(local) ? { typeOnly: true } : {}),
								...(nsSpecifierLine !== undefined ? { sourceLine: nsSpecifierLine } : {})
							});
						}
					}
					continue;
				}

				// This might be a re-export - use getAliasedSymbol to find the original
				// (a star-projected binding declared in its target is its own original)
				const aliasedSymbol = isAlias ? checker.getAliasedSymbol(exportSymbol) : exportSymbol;
				const originalSource = getPrimaryDeclarationSourceFile(aliasedSymbol);

				if (originalSource) {
					const originalFileName = stripVirtualSuffix(originalSource.fileName);

					// Check if this is a CROSS-FILE re-export (original in different file)
					if (originalFileName !== currentFileName) {
						// The local export statement, shared by the source, gated, and
						// external arms. JSDoc on `/** Doc */ export {...} from './x'`
						// lives on the ExportDeclaration, not on the canonical's
						// declaration in the foreign file.
						const local = getLocalExportStatement(exportSymbol, sourceFile);
						const specifierTypeOnly = local ? isTypeOnlyLocalExport(local) : !!star?.isTypeOnly;
						const specifierLine = local ? lineOf(local.node) : starLine;
						const localTsdoc = local ? parseComment(local.statement, sourceFile) : undefined;

						// Synthesize a full alias declaration under `publicName`
						// pointing at `module` and record it. Local JSDoc overrides the
						// canonical's (mirrors within-file branch semantics —
						// `applyToDeclaration` only overwrites fields the local tsdoc
						// actually populates, so canonical fields without a local
						// override are preserved).
						const pushSynthesizedAlias = (publicName: string, module: string): void => {
							const decl = synthesizeCrossFileAlias(
								publicName,
								aliasedSymbol,
								originalSource,
								module,
								specifierLine,
								ctx
							);
							if (localTsdoc) {
								applyToDeclaration(decl, localTsdoc);
							}
							declarations.push({ declaration: decl, nodocs: !!localTsdoc?.nodocs });
						};

						// A component the program has no virtual for (see
						// `virtuallessSvelteTarget`): nothing can be read off it, but
						// the statement still publishes a name, so it documents as a
						// `partial` component rather than vanishing into the external
						// arm below.
						const virtualless =
							local && virtuallessSvelteTarget(local.statement, aliasedSymbol, currentFileName);
						if (virtualless !== undefined && !isExternalPath(virtualless)) {
							const module = extractPath(virtualless, options);
							const componentName = getComponentName(virtualless);
							const decl: DeclarationJsonBuild = {
								name: exportSymbol.name === 'default' ? componentName : exportSymbol.name,
								kind: 'component',
								partial: true,
								aliasOf: { module, name: componentName },
								sourceLine: specifierLine
							};
							if (localTsdoc) applyToDeclaration(decl, localTsdoc);
							declarations.push({ declaration: decl, nodocs: !!localTsdoc?.nodocs });
							continue;
						}

						// Only link when the original's module is in the output; one
						// that emits nothing (gated, or a source file outside the
						// analyzed inputs) takes the synthesizing arm below
						if (ctx.isEmittedFile(originalFileName)) {
							const originalModule = extractPath(originalFileName, options);
							// Use the IMMEDIATE alias (one hop) for rename detection so a
							// same-name re-export of an intermediate alias is not mistaken
							// for a rename relative to the deeply-resolved canonical (whose
							// name may differ from this hop's name).
							const immediateAlias = isAlias
								? checker.getImmediateAliasedSymbol(exportSymbol)
								: undefined;
							const immediateName = immediateAlias?.name ?? aliasedSymbol.name;
							const isRenamed = exportSymbol.name !== immediateName;

							if (isRenamed) {
								// Renamed re-export (`export {foo as bar}`, `export {default as
								// Foo} from './X.svelte'`) — synthesize the alias declaration.
								pushSynthesizedAlias(exportSymbol.name, originalModule);
							} else {
								// Same-name re-export — track for alsoExportedFrom on the
								// canonical-for-this-name. The walk lands on the deepest
								// same-named symbol so a same-name re-export of an intermediate
								// alias points at that alias's module, not the deeply-resolved
								// canonical (whose declaration uses the pre-rename name and
								// wouldn't match in `mergeReExports`).
								const canonical = walkSameNameCanonical(exportSymbol, immediateAlias, checker);
								const canonicalSource = getPrimaryDeclarationSourceFile(canonical);
								const canonicalFile = canonicalSource
									? stripVirtualSuffix(canonicalSource.fileName)
									: originalFileName;
								// `export {default} from './x'` is a same-name re-export of the
								// default slot — re-keyed by component name for Svelte
								// canonicals so `mergeReExports` matches (see
								// `reExportPublicName`).
								const reExportName = reExportPublicName(
									exportSymbol.name,
									canonicalSource?.fileName,
									canonicalFile
								);

								// The walk canonical can be gated even though the deep
								// canonical is source — a chain through a gated *rename* hop
								// (`internal/helper.ts: export {y as x}` over a source
								// `base.ts`). No declaration exists under the walk canonical's
								// key, so link-only would drop the name entirely; synthesize
								// unconditionally like the gated arm below (mirrors the
								// namespace classifier's `canonicalGated`). `aliasOf` points at
								// the deep canonical — a real declaration.
								const canonicalGated =
									!isExternalPath(canonicalFile) && !ctx.isEmittedFile(canonicalFile);

								// Position 3 (content-conditional synthesis): if the local export
								// statement carries JSDoc or @nodocs, synthesize an alias declaration
								// in the re-exporting module so the local content has a place to live.
								// Without local content, fall through to the alsoExportedFrom link only.
								if (localTsdoc || canonicalGated) {
									pushSynthesizedAlias(reExportName, originalModule);
								}

								// `@nodocs` on a same-name re-export suppresses both the synthesized
								// alias (filtered via nodocs flag) and the alsoExportedFrom link.
								// Without `@nodocs`, the link is preserved so canonical declarations
								// continue to surface every module that re-exports them.
								if (
									!localTsdoc?.nodocs &&
									canonicalFile !== currentFileName &&
									ctx.isEmittedFile(canonicalFile)
								) {
									reExports.push({
										name: reExportName,
										module: extractPath(canonicalFile, options),
										...(specifierTypeOnly ? { typeOnly: true } : {}),
										...(specifierLine !== undefined ? { sourceLine: specifierLine } : {})
									});
								}
							}
							continue;
						}

						// Re-export whose canonical is project-local but emits no
						// module (the `internal/` convention, user excludes, a source
						// file outside the analyzed inputs): the statement publishes the
						// symbol *here*, and the canonical module emits nothing — so
						// this module owns the docs. A full
						// alias declaration is synthesized (same-name and renamed
						// alike; there is no canonical to link an `alsoExportedFrom`
						// edge to), inheriting the canonical's analyzed shape, with
						// `aliasOf` kept for provenance and canonical-identity dedupe
						// in `findDuplicates` — its `module` references a module
						// absent from output, a documented margin. Svelte defaults
						// re-key to the component's filename-derived name as in the
						// source arm.
						if (!isExternalPath(originalFileName)) {
							pushSynthesizedAlias(
								reExportPublicName(exportSymbol.name, originalSource.fileName, originalFileName),
								extractPath(originalFileName, options)
							);
							continue;
						}

						// Re-export from an external module. Direct forms
						// (`export {x} from 'pkg'`, `export * as ns from 'pkg'`) are
						// captured as externalReExports — but only when the statement's
						// *immediate* target is itself external: chains that reach a
						// package through another source module stay silent (that module
						// owns the entry), as do import-then-export forms (their
						// specifier lives on an import statement, and their immediate
						// alias is the local import binding). The gate is real
						// externality, not `!isSource` — a chain reaching a package
						// through a project-local *gated* module also stays silent
						// (nothing owns the entry, a documented margin) rather than
						// recording a relative path as a package specifier.
						const immediateExternal = isAlias
							? checker.getImmediateAliasedSymbol(exportSymbol)
							: undefined;
						const immediateExternalFile =
							immediateExternal && getPrimaryDeclarationFile(immediateExternal);
						if (!immediateExternalFile || !isExternalPath(immediateExternalFile)) continue;
						if (!local?.statement.moduleSpecifier) continue;
						if (!ts.isStringLiteral(local.statement.moduleSpecifier)) continue;
						if (localTsdoc?.nodocs) continue;
						const originalName = ts.isExportSpecifier(local.node)
							? local.node.propertyName?.text
							: undefined;
						externalReExports.push({
							name: exportSymbol.name,
							specifier: local.statement.moduleSpecifier.text,
							...(originalName !== undefined ? { originalName } : {}),
							...(specifierTypeOnly ? { typeOnly: true } : {}),
							sourceLine: specifierLine
						});
						continue;
					}
					// Within-file alias (export { x as y }) - fall through to normal analysis
				}
			}

			// Star-projected exports surface as the target module's own symbols —
			// no Alias flag, declarations in a foreign file (`export * from './a'`
			// merges a.ts's export table; there is no per-name alias node). Their
			// encoding is `starExports`; analyzing them here would duplicate the
			// canonical declaration into this module (triggering spurious
			// duplicate_declaration diagnostics, with sourceLine pointing into
			// the foreign file). A materialized star binding was handled by the
			// arms above, or has nothing resolvable to describe.
			if (star || (!isAlias && !isDeclaredInFile(exportSymbol, currentFileName))) continue;

			// Normal export or within-file alias - declared in this file.
			// For within-file aliases (export { x } or export { x as y }), resolve to
			// the aliased symbol so that inferDeclarationKind sees the actual declaration
			// node (e.g., VariableDeclaration with ArrowFunction) instead of the ExportSpecifier.
			const symbolToAnalyze = isAlias ? checker.getAliasedSymbol(exportSymbol) : exportSymbol;
			const analysisResult = analyzeDeclaration(symbolToAnalyze, sourceFile, ctx);
			const { declaration } = analysisResult;
			let { nodocs } = analysisResult;
			// Preserve the export name for within-file renames (export { x as y }).
			// Renaming TO `default` (`export {x as default}`) lands in the default
			// slot — `exportSymbol.name === 'default'` and the assignment carries
			// it through. The default slot is just another name in the export
			// object; no special-casing needed.
			if (isAlias && declaration.name !== exportSymbol.name) {
				declaration.name = exportSymbol.name;
			}
			// For within-file aliases, check the export statement for JSDoc.
			// The aliased symbol's declaration (e.g., svelte2tsx-generated const) may lack JSDoc,
			// but the export statement (e.g., /** Doc */ export { greet }) may have it.
			if (isAlias) {
				const local = getLocalExportStatement(exportSymbol, sourceFile);
				const exportTsdoc = local ? parseComment(local.statement, sourceFile) : undefined;
				if (exportTsdoc) {
					applyToDeclaration(declaration, exportTsdoc);
					if (exportTsdoc.nodocs) {
						nodocs = true;
					}
				}
			}
			// Include all declarations with nodocs flag - consumer decides filtering policy
			declarations.push({ declaration, nodocs });
		}
	}

	return {
		moduleComment,
		declarations,
		reExports,
		starExports,
		externalReExports,
		externalStarExports
	};
};

/**
 * Analyze a TypeScript symbol and extract rich metadata.
 *
 * This is a high-level function that combines TSDoc parsing with TypeScript
 * type analysis to produce complete declaration metadata. Suitable for use
 * in documentation generators, IDE integrations, and other tooling.
 *
 * @param symbol - the TypeScript symbol to analyze
 * @param sourceFile - the source file containing the symbol
 * @param ctx - the extraction pass's context (checker, diagnostics, externality predicate, alias registry)
 * @returns complete declaration metadata including docs, types, and parameters, plus nodocs flag
 */
export const analyzeDeclaration = (
	symbol: ts.Symbol,
	sourceFile: ts.SourceFile,
	ctx: ExtractContext
): DeclarationAnalysis => {
	const declNode = selectDeclarationNode(symbol);
	// Pass the symbol's name through verbatim. Default-slot symbols
	// (`export default ...`, `export {x as default}`) carry `symbol.name === 'default'`
	// — that's the actual export-object key in JS (`ns.default`,
	// `import {default as X}`), not a sentinel for "no name." Consumers that need
	// to render `import X from 'mod'` form branch on `name === 'default'`.
	const name = symbol.name;

	// Determine kind (fallback to 'variable' if no declaration node)
	const kind = declNode ? inferDeclarationKind(symbol, declNode) : 'variable';

	const result: DeclarationJsonBuild = {
		name,
		kind
	};

	if (!declNode) {
		return { declaration: result, nodocs: false };
	}

	// Extract TSDoc — `parseComment` filters `@module` blocks (handled by
	// `extractModuleComment`), so a first declaration under a module comment
	// keeps its own JSDoc
	let tsdoc = parseComment(declNode, sourceFile);
	let nodocs = tsdoc?.nodocs ?? false;
	// Merged value+type symbol with the type-space node selected: the schema
	// convention often documents the const, so fall back to the value
	// declaration's JSDoc when the selected node carries none. `@nodocs` on
	// either declaration suppresses.
	const mergedValueNode =
		symbol.valueDeclaration && symbol.valueDeclaration !== declNode
			? symbol.valueDeclaration
			: undefined;
	if (mergedValueNode) {
		const valueTsdoc = parseComment(mergedValueNode, sourceFile);
		if (valueTsdoc?.nodocs) nodocs = true;
		if ((!tsdoc || !hasDocContent(tsdoc)) && valueTsdoc && hasDocContent(valueTsdoc)) {
			tsdoc = valueTsdoc;
		}
	}
	applyToDeclaration(result, tsdoc);

	// Extract source line — from the selected node, so a merged value+type
	// symbol points at its type-space declaration
	const start = declNode.getStart(sourceFile);
	const startPos = sourceFile.getLineAndCharacterOfPosition(start);
	result.sourceLine = startPos.line + 1;

	// Extract type-specific info
	if (result.kind === 'function') {
		extractFunctionInfo(declNode, symbol, result, tsdoc, ctx);
	} else if (result.kind === 'type' || result.kind === 'interface') {
		// A merged value+type symbol: the type meaning won the declaration slot,
		// but the name is also importable as a runtime value — mark it so
		// consumers (e.g. generateImport) don't render a type-only import
		if (mergedValueNode) result.mergedValue = true;
		extractTypeInfo(declNode, result, ctx);
		// the nodocs gate is explicit because extraction runs before the nodocs
		// filter in analyze-core — an excluded alias must not warn
		if (!nodocs && ts.isTypeAliasDeclaration(declNode)) {
			warnAliasLost(declNode, name, ctx);
		}
	} else if (result.kind === 'enum') {
		extractEnumInfo(declNode, result, ctx);
	} else if (result.kind === 'class') {
		extractClassInfo(declNode, result, ctx);
	} else if (result.kind === 'variable') {
		extractVariableInfo(declNode, symbol, result, ctx);
	}

	return { declaration: result, nodocs };
};

/**
 * Written right-hand-side node kinds that can produce an alias-lost type — the
 * positive syntactic co-gate for the `alias_lost` diagnostic. Indexed access
 * and conditionals are the `z.infer`-class losses, `TypeQuery` covers
 * `typeof DEFAULTS`, and `TypeReference` covers both `z.infer<typeof S>`
 * itself and `type A = B` over a lost `B`. Everything else — template
 * literals, `keyof` (`TypeOperator`), and exotic future forms — stays quiet:
 * those print origin-preserving text despite the semantic predicate matching,
 * and fail-quiet is right for a warning.
 */
const ALIAS_LOST_RHS_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
	ts.SyntaxKind.IndexedAccessType,
	ts.SyntaxKind.ConditionalType,
	ts.SyntaxKind.TypeQuery,
	ts.SyntaxKind.TypeReference
]);

/**
 * Emit the `alias_lost` warning for a type-alias declaration whose name the
 * checker dropped, gated to fire only where the docs actually degrade and
 * nothing self-heals:
 *
 * - a registry must be in hand (`ctx.aliasRegistry` — without the pre-pass,
 *   recoverability is unknowable and direct extractor callers stay quiet)
 * - the written right-hand side is a loss-capable form (`ALIAS_LOST_RHS_KINDS`)
 * - the resolved type is alias-lost (`isAliasLostType`)
 * - the registry cannot recover it (`byType` covers ambiguity twins too — a
 *   lost alias identity-equal to a registered winner recovers at use sites
 *   under the winner's name, so warning on it would be noise)
 * - it isn't a literal-only union (`z.enum` outputs) or a brand-like
 *   intersection (`.brand()`) — both degrade readably and have no author-side
 *   fix worth demanding
 *
 * The caller supplies the explicit `@nodocs` gate. One warning per alias
 * declaration per cycle — `registry.warnedAliasLost` dedupes, because
 * re-export synthesis (`synthesizeCrossFileAlias`, within-file renames)
 * re-analyzes canonical declarations and would otherwise warn once per
 * analyzing site. Two non-recoverable aliases over one lost type still warn
 * separately (each names its own declaration site).
 */
const warnAliasLost = (node: ts.TypeAliasDeclaration, name: string, ctx: ExtractContext): void => {
	const registry = ctx.aliasRegistry;
	if (!registry) return;
	if (registry.warnedAliasLost.has(node)) return;
	if (!ALIAS_LOST_RHS_KINDS.has(node.type.kind)) return;
	// The svelte2tsx-synthesized component alias (`<Name>__SvelteComponent_`,
	// alias-lost by construction for generic components) is not an author-side
	// type — the svelte layer filters it from declarations after the walk, so
	// the warning skips it too, mirroring the registry pre-pass's virtual skip.
	if (isSvelteVirtualPath(node.getSourceFile().fileName) && isSvelte2tsxGeneratedExport(name)) {
		return;
	}
	let type: ts.Type;
	try {
		type = ctx.checker.getTypeAtLocation(node);
	} catch {
		// extraction already diagnosed the failure (`type_extraction_failed`)
		return;
	}
	if (!isAliasLostType(type)) return;
	if (registry.byType.has(type)) return;
	if (isLiteralOnlyUnion(type) || isBrandLikeIntersection(type)) return;
	registry.warnedAliasLost.add(node);
	const loc = getNodeLocation(node);
	ctx.diagnostics.push({
		kind: 'alias_lost',
		file: loc.file,
		line: loc.line,
		column: loc.column,
		message: `Type alias "${name}" loses its name at use sites — the right-hand side resolves to a type the checker has no name for, so unannotated positions document its structure instead of the alias.`,
		severity: 'warning',
		aliasName: name
	});
};

/**
 * Extract module-level comment.
 *
 * @internal Used by `analyzeTypescriptModule` and `analyzeSvelteModule`'s
 * `<script module>` handling. Exposed via the `svelte-docinfo/typescript-exports.js`
 * subpath so the Svelte analyzer can reuse it without circular imports, but
 * **not part of the stable barrel export**.
 *
 * Requires `@module` tag to identify module comments. The tag line is stripped
 * from the output. Supports optional module renaming: `@module custom-name`.
 *
 * @returns cleaned module comment text (with `@module` line removed), or `undefined` if no `@module` comment found
 * @see {@link https://typedoc.org/documents/Tags._module.html|TypeDoc @module documentation}
 */
export const extractModuleComment = (sourceFile: ts.SourceFile): string | undefined => {
	const fullText = sourceFile.getFullText();

	// Collect all JSDoc comments in the file
	const allComments: Array<{ pos: number; end: number }> = [];

	// Check for comments at the start of the file (before any statements)
	const leadingComments = ts.getLeadingCommentRanges(fullText, 0);
	if (leadingComments?.length) {
		allComments.push(...leadingComments);
	}

	// Check for comments before each statement
	for (const statement of sourceFile.statements) {
		const comments = ts.getLeadingCommentRanges(fullText, statement.getFullStart());
		if (comments?.length) {
			allComments.push(...comments);
		}
	}

	// Find the first comment with `@module` tag
	for (const comment of allComments) {
		const commentText = fullText.substring(comment.pos, comment.end);
		if (!commentText.trimStart().startsWith('/**')) continue;

		// Clean the comment first, then check for tag at start of line
		const cleaned = cleanComment(commentText);
		if (!cleaned) continue;

		// Check for `@module` as a proper tag (at start of line, not mentioned in prose)
		if (/(?:^|\n)@module\b/.test(cleaned)) {
			const stripped = stripModuleTag(cleaned);
			return stripped || undefined;
		}
	}

	return undefined;
};

/**
 * Warn when a module comment carries `@nodocs`.
 *
 * The tag has no module-level meaning — it applies to declarations and export
 * statements — so its presence in a `@module` comment is always author
 * confusion: it does nothing except remain verbatim in `moduleComment` text.
 * Same line-start detection as `extractModuleComment`'s `@module` test, so a
 * backticked or mid-prose mention doesn't trigger.
 *
 * @param diagnosticFile - absolute source id, the form
 *   `normalizeDiagnosticPaths` rewrites to the project-root-relative
 *   `Diagnostic.file` contract. Not a module path — those are relative to
 *   `sourceRoot`, and normalization passes an already-relative path through
 *   untouched, so a module path here ships as a second base for the same file.
 *
 * @internal Split by source, not by file type: `analyzeExports` covers TS
 * files only — it passes `undefined` for a svelte2tsx virtual, where hoisted
 * instance-script comments would read as module comments — so
 * `analyzeSvelteModule` owns all three Svelte sources (instance script,
 * `<script module>`, HTML comment), reading each from the original file.
 */
export const warnModuleCommentNodocs = (
	moduleComment: string | undefined,
	diagnosticFile: string,
	diagnostics: Array<Diagnostic>
): void => {
	if (!moduleComment || !/(?:^|\n)@nodocs\b/.test(moduleComment)) return;
	diagnostics.push({
		kind: 'misplaced_tag',
		file: diagnosticFile,
		message:
			'@nodocs in a module comment has no effect — it applies to declarations and export statements; to omit a module from analysis, use exclude patterns',
		severity: 'warning',
		tagName: 'nodocs'
	});
};

/**
 * Strip `@module` tag line from comment text.
 *
 * Handles formats:
 * - `@module` (standalone)
 * - `@module module-name` (with rename)
 */
const stripModuleTag = (text: string): string => {
	// Remove lines that START with `@module` (not mentioned in prose)
	const lines = text.split('\n');
	const filtered = lines.filter((line) => !/^\s*@module\b/.test(line));
	return filtered.join('\n').trim();
};

/**
 * Extract star exports (`export * from './module'` / `'pkg'`) from a source file.
 *
 * Uses the type checker to resolve module specifiers. Project-local targets that
 * emit a module land in `starExports` as `sourceRoot`-relative paths; ones that
 * emit nothing are omitted, their bindings materialized by the caller
 * (`collectMaterializedStars`). External targets land in `externalStarExports`
 * as written. Unresolvable specifiers (missing package, typo) are silently
 * skipped.
 *
 * Statement-level `@nodocs` suppresses the entry — the same rule as the other
 * re-export encodings (same-name edges and renamed aliases).
 */
const extractStarExports = (
	sourceFile: ts.SourceFile,
	checker: ts.TypeChecker,
	options: ModuleSourceOptions,
	isExternalPath: (file: string) => boolean,
	isEmittedFile: IsEmittedFile
): { starExports: Array<string>; externalStarExports: Array<string> } => {
	const starExports: Array<string> = [];
	const externalStarExports: Array<string> = [];

	for (const statement of sourceFile.statements) {
		if (
			ts.isExportDeclaration(statement) &&
			!statement.exportClause && // No exportClause means `export *`
			statement.moduleSpecifier &&
			ts.isStringLiteral(statement.moduleSpecifier)
		) {
			if (parseComment(statement, sourceFile)?.nodocs) continue;
			// Use the type checker to resolve the module - it has already resolved all imports
			// during program creation, so this leverages TypeScript's full module resolution
			const moduleSymbol = checker.getSymbolAtLocation(statement.moduleSpecifier);
			// Virtual paths for Svelte files are normalized by getPrimaryDeclarationFile
			const resolvedPath = moduleSymbol && getPrimaryDeclarationFile(moduleSymbol);
			if (resolvedPath) {
				if (!isExternalPath(resolvedPath)) {
					// Project-local target. One that emits a module is recorded
					// here and its bindings stay with it. One that emits nothing
					// (gated, or outside the analyzed inputs) is left out: its
					// bindings are materialized in this module instead (see
					// `collectMaterializedStars`), so no entry points at a module
					// the output lacks.
					if (isEmittedFile(resolvedPath)) {
						starExports.push(extractPath(resolvedPath, options));
					}
				} else {
					// External package — record the specifier as written
					externalStarExports.push(statement.moduleSpecifier.text);
				}
			}
			// If the module couldn't be resolved (missing package, typo), skip it
		}
	}

	return { starExports, externalStarExports };
};
