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

import ts from 'typescript';

import type {
	DeclarationAnalysis,
	ModuleAnalysis,
	ModuleExportsAnalysis,
	DeclarationJsonBuild,
} from './declaration-build.js';
import type {ReExportJsonInput, ExternalReExportJsonInput} from './types.js';
import type {Diagnostic} from './diagnostics.js';
import {parseComment, applyToDeclaration, cleanComment} from './tsdoc.js';
import {
	type SourceFileInfo,
	stripVirtualSuffix,
	SVELTE_VIRTUAL_SUFFIX,
	getComponentName,
} from './source.js';
import {
	type ModuleSourceOptions,
	extractDependencies,
	extractPath,
	isSource,
} from './source-config.js';
import {type IsExternalFile, createIsExternalFile} from './typescript-program.js';
import {inferDeclarationKind} from './typescript-extract-shared.js';
import {extractFunctionInfo, extractVariableInfo} from './typescript-extract-function.js';
import {extractTypeInfo, extractEnumInfo} from './typescript-extract-type.js';
import {extractClassInfo} from './typescript-extract-class.js';

/**
 * Analyze a TypeScript file and extract module metadata.
 *
 * Wraps `analyzeExports` and adds dependency information via `extractDependencies`
 * from the source file info if available.
 *
 * This is a high-level function suitable for building documentation or library metadata.
 * For lower-level analysis, use `analyzeExports` directly.
 *
 * @param sourceFileInfo - the source file info (from file system, build pipeline, or other source)
 * @param tsSourceFile - TypeScript source file from the program
 * @param modulePath - the module path (relative to source root)
 * @param checker - TypeScript type checker
 * @param options - module source options for path extraction
 * @param diagnostics - diagnostics collector for non-fatal issues
 * @returns module metadata and re-export information
 */
export const analyzeTypescriptModule = (
	sourceFileInfo: SourceFileInfo & {dependents?: ReadonlyArray<string>},
	tsSourceFile: ts.SourceFile,
	modulePath: string,
	checker: ts.TypeChecker,
	options: ModuleSourceOptions,
	diagnostics: Array<Diagnostic>,
): ModuleAnalysis => {
	// Use the mid-level helper for core analysis
	const {
		moduleComment,
		declarations,
		reExports,
		starExports,
		externalReExports,
		externalStarExports,
	} = analyzeExports(tsSourceFile, checker, options, diagnostics);

	// Extract dependencies and dependents if provided
	const {dependencies, dependents} = extractDependencies(sourceFileInfo, options);

	return {
		path: modulePath,
		moduleComment,
		declarations,
		dependencies,
		dependents,
		starExports,
		reExports,
		externalReExports,
		externalStarExports,
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
	checker: ts.TypeChecker,
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
 * table contains `ns`) never reach classification — the caller's locality
 * skip filters them first; `starExports` is their sole encoding like every
 * other star-projected binding.
 */
type NamespaceClassification =
	| {kind: 'origination'; sourceModule: string}
	| {kind: 'same-name'; canonicalModule: string; sourceModule: string}
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
): NamespaceClassification | null => {
	const deeplyAliased = checker.getAliasedSymbol(exportSymbol);
	if ((deeplyAliased.flags & ts.SymbolFlags.ValueModule) === 0) return null;

	// Source module = where the deeply-resolved module symbol lives.
	const sourceModuleFile = getPrimaryDeclarationFile(deeplyAliased);
	if (!sourceModuleFile || !isSource(sourceModuleFile, options)) return null;

	// Origination: export's first declaration is itself a NamespaceExport in
	// this file. The caller's locality skip filters star-projected bindings
	// before classification, but merged symbols could put a foreign
	// declaration first — bail rather than misclassify.
	const exportDecl = exportSymbol.declarations?.[0];
	if (exportDecl && ts.isNamespaceExport(exportDecl)) {
		const definingFile = stripVirtualSuffix(exportDecl.getSourceFile().fileName);
		if (definingFile !== currentFileName) return null;
		return {kind: 'origination', sourceModule: extractPath(sourceModuleFile, options)};
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
		if (!isSource(namespaceDefiningFile, options)) return null;
		return {
			kind: 'renamed',
			namespaceDefiningFile: extractPath(namespaceDefiningFile, options),
			sourceModule: extractPath(sourceModuleFile, options),
			canonicalName,
		};
	}

	// Same-name: the canonical-for-this-name may be an upstream renamed alias
	// declaration, not the original NamespaceExport.
	const canonical = walkSameNameCanonical(exportSymbol, immediateAlias, checker);
	const canonicalDecl = canonical.declarations?.[0];
	if (!canonicalDecl) return null;
	const canonicalFile = stripVirtualSuffix(canonicalDecl.getSourceFile().fileName);
	if (canonicalFile === currentFileName) return null;
	if (!isSource(canonicalFile, options)) return null;
	return {
		kind: 'same-name',
		canonicalModule: extractPath(canonicalFile, options),
		sourceModule: extractPath(sourceModuleFile, options),
	};
};

/**
 * Whether any of the symbol's declarations lives in `fileName`
 * (virtual-suffix-normalized).
 *
 * Merged symbols (module augmentation, declaration merging) can have
 * declarations in several files — a symbol counts as declared in the file
 * when at least one declaration is, so checking a single declaration node
 * would drop locally-declared exports depending on bind order. Symbols
 * without declarations are treated as declared in the file (permissive).
 */
const isDeclaredInFile = (symbol: ts.Symbol, fileName: string): boolean => {
	const decls = symbol.declarations;
	if (!decls?.length) return true;
	return decls.some((d) => stripVirtualSuffix(d.getSourceFile().fileName) === fileName);
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
 * The local export statement and binding node for an alias export symbol —
 * `{node, statement}` where `node` is the `ExportSpecifier` (or, for
 * `export * as ns`, the `NamespaceExport`) and `statement` its
 * `ExportDeclaration`.
 *
 * Returns `undefined` when the statement isn't in `sourceFile`: merged
 * symbols can put a foreign declaration first, and parsing JSDoc or
 * positions there would attribute another module's content here.
 */
const getLocalExportStatement = (
	exportSymbol: ts.Symbol,
	sourceFile: ts.SourceFile,
): {node: ts.ExportSpecifier | ts.NamespaceExport; statement: ts.ExportDeclaration} | undefined => {
	const node = exportSymbol.declarations?.[0];
	if (!node) return undefined;
	if (ts.isExportSpecifier(node)) {
		const statement = node.parent.parent;
		if (statement.getSourceFile() !== sourceFile) return undefined;
		return {node, statement};
	}
	if (ts.isNamespaceExport(node)) {
		const statement = node.parent;
		if (statement.getSourceFile() !== sourceFile) return undefined;
		return {node, statement};
	}
	return undefined;
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
 * Synthesize a cross-file alias declaration for a renamed or documented
 * same-name re-export.
 *
 * Svelte canonicals get a `kind: 'component'` placeholder — running
 * `analyzeDeclaration` on svelte2tsx's `__SvelteComponent_` type alias would
 * leak internal names; phase-2 `resolveComponentAliases` copies
 * props/acceptsChildren/lang/etc. from the canonical (fill-gaps-only, so
 * local JSDoc applied by the caller sticks). Everything else is analyzed in
 * its own source file so the alias inherits `typeSignature`, `reactivity`,
 * `docComment`, `parameters`, etc.
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
	checker: ts.TypeChecker,
	diagnostics: Array<Diagnostic>,
	isExternalFile: IsExternalFile,
): DeclarationJsonBuild => {
	if (originalSource.fileName.endsWith(SVELTE_VIRTUAL_SUFFIX)) {
		return {
			name: publicName,
			kind: 'component',
			aliasOf: {module: originalModule, name: getComponentName(originalModule)},
			sourceLine: specifierLine,
		};
	}
	const {declaration: analyzed} = analyzeDeclaration(
		aliasedSymbol,
		originalSource,
		checker,
		diagnostics,
		isExternalFile,
	);
	const canonicalName = analyzed.name!;
	analyzed.name = publicName;
	analyzed.aliasOf = {module: originalModule, name: canonicalName};
	analyzed.sourceLine = specifierLine;
	return analyzed;
};

/**
 * Analyze all exports from a TypeScript source file.
 *
 * Extracts the module-level comment via `extractModuleComment`, star exports via
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
 * @param checker - the TypeScript type checker
 * @param options - module source options for path extraction in re-exports
 * @param diagnostics - diagnostics collector for non-fatal issues
 * @returns module comment, declarations, re-exports (source + external), and star exports (source + external)
 */
export const analyzeExports = (
	sourceFile: ts.SourceFile,
	checker: ts.TypeChecker,
	options: ModuleSourceOptions,
	diagnostics: Array<Diagnostic>,
): ModuleExportsAnalysis => {
	const declarations: Array<DeclarationAnalysis> = [];
	const reExports: Array<ReExportJsonInput> = [];
	const externalReExports: Array<ExternalReExportJsonInput> = [];

	const isExternalFile = createIsExternalFile(options);

	// Extract module-level comment
	const moduleComment = extractModuleComment(sourceFile);

	// Extract star exports (export * from './module' / 'pkg')
	const {starExports, externalStarExports} = extractStarExports(sourceFile, checker, options);

	// Normalize virtual paths once (e.g., Foo.svelte.__svelte2tsx__.ts → Foo.svelte)
	// so re-export tracking matches real module paths
	const currentFileName = stripVirtualSuffix(sourceFile.fileName);

	warnModuleCommentNodocs(moduleComment, currentFileName, diagnostics);

	// 1-based line of a node in this file. Virtual coordinates for Svelte
	// `<script module>` sources — remapped in `analyzeSvelteModule`.
	const lineOf = (node: ts.Node): number =>
		sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

	// Get all exported symbols
	const symbol = checker.getSymbolAtLocation(sourceFile);
	if (symbol) {
		const exports = checker.getExportsOfModule(symbol);
		for (const exportSymbol of exports) {
			// Check if this is an alias (potential re-export) using the Alias flag
			const isAlias = (exportSymbol.flags & ts.SymbolFlags.Alias) !== 0;

			if (isAlias) {
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
				// namespace bindings are silenced uniformly.
				if (!isDeclaredInFile(exportSymbol, currentFileName)) continue;

				// Namespace re-exports (`export * as ns from './x'` and re-exports
				// of such bindings) need special handling: their deeply-resolved
				// canonical is a module symbol, and `analyzeDeclaration` would fall
				// through to `kind: 'variable'` and produce a `typeof import("/abs/path")`
				// signature that leaks the publisher's filesystem path. Detection
				// uses the `ValueModule` flag on the deeply-resolved alias, which
				// is robust to arbitrary re-export chain depth (the immediate-alias
				// shape is fragile — intermediate hops are `ExportSpecifier` nodes,
				// not `NamespaceExport`).
				const nsClass = classifyNamespaceReExport(exportSymbol, checker, currentFileName, options);
				if (nsClass) {
					// The locality skip above filters star-projected bindings before
					// classification, so origination/renamed/same-name statements are
					// local; `getLocalExportStatement`'s identity check stays as
					// defense against merged symbols whose first declaration could be
					// a foreign node.
					const local = getLocalExportStatement(exportSymbol, sourceFile);
					const localTsdoc = local ? parseComment(local.statement, sourceFile) : undefined;
					const nsSpecifierLine = local ? lineOf(local.node) : undefined;

					if (nsClass.kind === 'origination') {
						const decl: DeclarationJsonBuild = {
							name: exportSymbol.name,
							kind: 'namespace',
							module: nsClass.sourceModule,
							sourceLine: nsSpecifierLine,
						};
						if (localTsdoc) {
							applyToDeclaration(decl, localTsdoc);
						}
						declarations.push({declaration: decl, nodocs: !!localTsdoc?.nodocs});
					} else if (nsClass.kind === 'renamed') {
						const decl: DeclarationJsonBuild = {
							name: exportSymbol.name,
							kind: 'namespace',
							module: nsClass.sourceModule,
							aliasOf: {
								module: nsClass.namespaceDefiningFile,
								name: nsClass.canonicalName,
							},
							// Synthesized alias — the local export specifier's line,
							// not the canonical's location
							sourceLine: nsSpecifierLine,
						};
						if (localTsdoc) {
							applyToDeclaration(decl, localTsdoc);
						}
						declarations.push({declaration: decl, nodocs: !!localTsdoc?.nodocs});
					} else {
						// Same-name re-export — link via alsoExportedFrom on the canonical.
						// Position 3 (content-conditional synthesis): when the local
						// statement carries JSDoc or `@nodocs`, also synthesize a
						// `kind: 'namespace'` alias declaration so the local content
						// has somewhere to live (mirrors non-namespace same-name semantics
						// at the standard alias path). `@nodocs` suppresses both the
						// alias and the link.
						if (localTsdoc) {
							const decl: DeclarationJsonBuild = {
								name: exportSymbol.name,
								kind: 'namespace',
								module: nsClass.sourceModule,
								aliasOf: {
									module: nsClass.canonicalModule,
									name: exportSymbol.name,
								},
								sourceLine: nsSpecifierLine,
							};
							applyToDeclaration(decl, localTsdoc);
							declarations.push({declaration: decl, nodocs: !!localTsdoc.nodocs});
						}
						if (!localTsdoc?.nodocs) {
							reExports.push({
								name: exportSymbol.name,
								module: nsClass.canonicalModule,
								...(local && isTypeOnlyLocalExport(local) ? {typeOnly: true} : {}),
								...(nsSpecifierLine !== undefined ? {sourceLine: nsSpecifierLine} : {}),
							});
						}
					}
					continue;
				}

				// This might be a re-export - use getAliasedSymbol to find the original
				const aliasedSymbol = checker.getAliasedSymbol(exportSymbol);
				const originalSource = getPrimaryDeclarationSourceFile(aliasedSymbol);

				if (originalSource) {
					const originalFileName = stripVirtualSuffix(originalSource.fileName);

					// Check if this is a CROSS-FILE re-export (original in different file)
					if (originalFileName !== currentFileName) {
						// The local export statement, shared by the source and external
						// arms. JSDoc on `/** Doc */ export {...} from './x'` lives on
						// the ExportDeclaration, not on the canonical's declaration in
						// the foreign file.
						const local = getLocalExportStatement(exportSymbol, sourceFile);
						const specifierTypeOnly = local ? isTypeOnlyLocalExport(local) : false;
						const specifierLine = local ? lineOf(local.node) : undefined;

						// Only track if the original is from a source module (not node_modules)
						if (isSource(originalFileName, options)) {
							const originalModule = extractPath(originalFileName, options);
							// Use the IMMEDIATE alias (one hop) for rename detection so a
							// same-name re-export of an intermediate alias is not mistaken
							// for a rename relative to the deeply-resolved canonical (whose
							// name may differ from this hop's name).
							const immediateAlias = checker.getImmediateAliasedSymbol(exportSymbol);
							const immediateName = immediateAlias?.name ?? aliasedSymbol.name;
							const isRenamed = exportSymbol.name !== immediateName;

							const localTsdoc = local ? parseComment(local.statement, sourceFile) : undefined;

							if (isRenamed) {
								// Renamed re-export (`export {foo as bar}`, `export {default as
								// Foo} from './X.svelte'`) — synthesize the alias declaration.
								const decl = synthesizeCrossFileAlias(
									exportSymbol.name,
									aliasedSymbol,
									originalSource,
									originalModule,
									specifierLine,
									checker,
									diagnostics,
									isExternalFile,
								);
								// Local JSDoc on the export statement overrides the canonical's
								// (mirrors within-file branch semantics). `applyToDeclaration` only
								// overwrites fields the local tsdoc actually populates, so canonical
								// fields without a local override are preserved.
								if (localTsdoc) {
									applyToDeclaration(decl, localTsdoc);
								}
								declarations.push({declaration: decl, nodocs: !!localTsdoc?.nodocs});
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
								// default slot. For Svelte components the canonical declaration
								// in `analyzeSvelteModule` is named after the file, not `'default'`
								// — so re-key the link by component name to match. For non-Svelte
								// defaults the canonical's name is `'default'` (the actual symbol
								// name); pass it through. Other same-name re-exports
								// (`export {foo}`) match the canonical by name as before.
								const isSvelteCanonical =
									canonicalSource?.fileName.endsWith(SVELTE_VIRTUAL_SUFFIX) ?? false;
								const reExportName =
									exportSymbol.name === 'default' && isSvelteCanonical
										? getComponentName(canonicalFile)
										: exportSymbol.name;

								// Position 3 (content-conditional synthesis): if the local export
								// statement carries JSDoc or @nodocs, synthesize an alias declaration
								// in the re-exporting module so the local content has a place to live.
								// Without local content, fall through to the alsoExportedFrom link only.
								if (localTsdoc) {
									const decl = synthesizeCrossFileAlias(
										reExportName,
										aliasedSymbol,
										originalSource,
										originalModule,
										specifierLine,
										checker,
										diagnostics,
										isExternalFile,
									);
									applyToDeclaration(decl, localTsdoc);
									declarations.push({declaration: decl, nodocs: !!localTsdoc.nodocs});
								}

								// `@nodocs` on a same-name re-export suppresses both the synthesized
								// alias (filtered via nodocs flag) and the alsoExportedFrom link.
								// Without `@nodocs`, the link is preserved so canonical declarations
								// continue to surface every module that re-exports them.
								if (
									!localTsdoc?.nodocs &&
									canonicalFile !== currentFileName &&
									isSource(canonicalFile, options)
								) {
									reExports.push({
										name: reExportName,
										module: extractPath(canonicalFile, options),
										...(specifierTypeOnly ? {typeOnly: true} : {}),
										...(specifierLine !== undefined ? {sourceLine: specifierLine} : {}),
									});
								}
							}
							continue;
						}

						// Re-export from an external module. Direct forms
						// (`export {x} from 'pkg'`, `export * as ns from 'pkg'`) are
						// captured as externalReExports — but only when the statement's
						// *immediate* target is itself external: chains that reach a
						// package through another source module stay silent (that module
						// owns the entry), as do import-then-export forms (their
						// specifier lives on an import statement, and their immediate
						// alias is the local import binding).
						const immediateExternal = checker.getImmediateAliasedSymbol(exportSymbol);
						const immediateExternalFile =
							immediateExternal && getPrimaryDeclarationFile(immediateExternal);
						if (!immediateExternalFile || isSource(immediateExternalFile, options)) continue;
						if (!local?.statement.moduleSpecifier) continue;
						if (!ts.isStringLiteral(local.statement.moduleSpecifier)) continue;
						if (parseComment(local.statement, sourceFile)?.nodocs) continue;
						const originalName = ts.isExportSpecifier(local.node)
							? local.node.propertyName?.text
							: undefined;
						externalReExports.push({
							name: exportSymbol.name,
							specifier: local.statement.moduleSpecifier.text,
							...(originalName !== undefined ? {originalName} : {}),
							...(specifierTypeOnly ? {typeOnly: true} : {}),
							sourceLine: specifierLine,
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
			// the foreign file).
			if (!isAlias && !isDeclaredInFile(exportSymbol, currentFileName)) continue;

			// Normal export or within-file alias - declared in this file.
			// For within-file aliases (export { x } or export { x as y }), resolve to
			// the aliased symbol so that inferDeclarationKind sees the actual declaration
			// node (e.g., VariableDeclaration with ArrowFunction) instead of the ExportSpecifier.
			const symbolToAnalyze = isAlias ? checker.getAliasedSymbol(exportSymbol) : exportSymbol;
			const analysisResult = analyzeDeclaration(
				symbolToAnalyze,
				sourceFile,
				checker,
				diagnostics,
				isExternalFile,
			);
			const {declaration} = analysisResult;
			let {nodocs} = analysisResult;
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
			declarations.push({declaration, nodocs});
		}
	}

	return {
		moduleComment,
		declarations,
		reExports,
		starExports,
		externalReExports,
		externalStarExports,
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
 * @param checker - the TypeScript type checker
 * @param diagnostics - diagnostics collector for non-fatal issues
 * @param isExternalFile - predicate for determining whether a source file is external to the project
 * @returns complete declaration metadata including docs, types, and parameters, plus nodocs flag
 */
export const analyzeDeclaration = (
	symbol: ts.Symbol,
	sourceFile: ts.SourceFile,
	checker: ts.TypeChecker,
	diagnostics: Array<Diagnostic>,
	isExternalFile: IsExternalFile,
): DeclarationAnalysis => {
	const declNode = symbol.valueDeclaration || symbol.declarations?.[0];
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
		kind,
	};

	if (!declNode) {
		return {declaration: result, nodocs: false};
	}

	// Extract TSDoc — `parseComment` filters `@module` blocks (handled by
	// `extractModuleComment`), so a first declaration under a module comment
	// keeps its own JSDoc
	const tsdoc = parseComment(declNode, sourceFile);
	const nodocs = tsdoc?.nodocs ?? false;
	applyToDeclaration(result, tsdoc);

	// Extract source line
	const start = declNode.getStart(sourceFile);
	const startPos = sourceFile.getLineAndCharacterOfPosition(start);
	result.sourceLine = startPos.line + 1;

	// Extract type-specific info
	if (result.kind === 'function') {
		extractFunctionInfo(declNode, symbol, checker, result, tsdoc, diagnostics);
	} else if (result.kind === 'type' || result.kind === 'interface') {
		extractTypeInfo(declNode, checker, result, diagnostics, isExternalFile);
	} else if (result.kind === 'enum') {
		extractEnumInfo(declNode, checker, result, diagnostics);
	} else if (result.kind === 'class') {
		extractClassInfo(declNode, checker, result, diagnostics);
	} else if (result.kind === 'variable') {
		extractVariableInfo(declNode, symbol, checker, result, diagnostics);
	}

	return {declaration: result, nodocs};
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
	const allComments: Array<{pos: number; end: number}> = [];

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
 * @internal Shared by `analyzeExports` (TS files and Svelte `<script module>`
 * virtuals) and `analyzeSvelteModule` (instance-script and HTML module
 * comments, which `analyzeExports` never sees).
 */
export const warnModuleCommentNodocs = (
	moduleComment: string | undefined,
	file: string,
	diagnostics: Array<Diagnostic>,
): void => {
	if (!moduleComment || !/(?:^|\n)@nodocs\b/.test(moduleComment)) return;
	diagnostics.push({
		kind: 'misplaced_tag',
		file,
		message:
			'@nodocs in a module comment has no effect — it applies to declarations and export statements; to omit a module from analysis, use exclude patterns',
		severity: 'warning',
		tagName: 'nodocs',
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
 * Uses the type checker to resolve module specifiers: source modules land in
 * `starExports` (as `sourceRoot`-relative paths), external modules in
 * `externalStarExports` (specifier as written). Unresolvable specifiers
 * (missing package, typo) are silently skipped.
 *
 * Statement-level `@nodocs` suppresses the entry — the same rule as the other
 * re-export encodings (same-name edges and renamed aliases).
 */
const extractStarExports = (
	sourceFile: ts.SourceFile,
	checker: ts.TypeChecker,
	options: ModuleSourceOptions,
): {starExports: Array<string>; externalStarExports: Array<string>} => {
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
				if (isSource(resolvedPath, options)) {
					starExports.push(extractPath(resolvedPath, options));
				} else {
					// External package — record the specifier as written
					externalStarExports.push(statement.moduleSpecifier.text);
				}
			}
			// If the module couldn't be resolved (missing package, typo), skip it
		}
	}

	return {starExports, externalStarExports};
};
