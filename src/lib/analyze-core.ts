/**
 * Pure two-phase analysis orchestrator.
 *
 * Extracted from `analyze.ts` to break what would otherwise be a circular
 * import: `session.ts` → `analyze.ts` (for the orchestrator) → `session.ts`
 * (for the wrappers). With the orchestrator here, both `session.ts` and
 * `analyze.ts` import downward into this module without depending on each
 * other.
 *
 * Public surface:
 *
 * - `analyzeCore` — runs phase 1 module dispatch + phase 2 re-export merge,
 *   returns `AnalyzeResultJson`. Caller supplies pre-prepared inputs (program,
 *   svelte virtuals, transform-failed IDs).
 * - `analyzeModule` — the per-module dispatcher (TS / Svelte / CSS / JSON).
 *   `@internal`; exposed for tests and power users via the subpath.
 * - `AnalyzeResultJson` / `OnDuplicates` / `OnDuplicatesCallback` — shared types
 *   surfaced through the main barrel directly from this module.
 * - `throwOnDuplicates` — convenience callback paired with `OnDuplicates`.
 * - `normalizeDiagnosticPaths` — boundary helper for build-tool integrations
 *   that bypass the session and collect their own diagnostics.
 * - `normalizeModulePathsInTypes` — output pass rewriting the absolute module
 *   paths the checker embeds in printed type text. Runs inside `analyzeCore`;
 *   exposed for the same reason as `normalizeDiagnosticPaths`, so a caller
 *   assembling modules itself through `analyzeModule` can meet the same
 *   output contract.
 *
 * @internal — module split is implementation detail; consumers go through
 * `analyze.ts` / `session.ts` for the stable surface.
 *
 * @module
 */

import { relative } from 'node:path';
import ts from 'typescript';
import { z } from 'zod';

import { ModuleJson, type ModuleJsonInput } from './types.ts';
import type { ModuleAnalysis } from './declaration-build.ts';
import { Diagnostic } from './diagnostics.ts';
import type { AnalysisLog } from './log.ts';
import { analyzeTypescriptModule } from './typescript-exports.ts';
import { analyzeSvelteModule, type SvelteVirtualFile } from './svelte.ts';
import {
	stripVirtualSuffix,
	SVELTE_VIRTUAL_SUFFIX,
	type SourceFileInfo,
	getComponentName
} from './source.ts';
import { type ModuleSourceOptions, extractPath, extractDependencies } from './source-config.ts';
import { toPosixPath, isAbsolutePosixPath } from './paths.ts';
import { buildAliasRegistry, type AliasRegistrySource } from './typescript-alias-registry.ts';
import type { AliasRegistry } from './typescript-extract-type-json.ts';
import {
	sortModules,
	findDuplicates,
	mergeReExports,
	resolveComponentAliases,
	compareStrings,
	type DuplicateDeclaration
} from './postprocess.ts';

// Duplicate handling

/**
 * Custom callback for handling duplicate declaration names.
 *
 * Use the `'throw'` or `'warn'` shortcuts on `onDuplicates` for the common
 * cases. Pass a function to fully control reporting.
 *
 * @param duplicates - map of declaration names to their `DuplicateDeclaration` occurrences across modules
 * @param log - logger for reporting (only `error` method required)
 */
export type OnDuplicatesCallback = (
	duplicates: Map<string, Array<DuplicateDeclaration>>,
	log: Pick<AnalysisLog, 'error'>
) => void;

/**
 * Behavior selector for duplicate declaration names across modules.
 *
 * - `'throw'` — throw an `Error` listing every duplicate (strict flat-namespace enforcement)
 * - `'warn'` — log to `log.error` and continue
 * - `OnDuplicatesCallback` — custom handler
 *
 * Omitted entirely: no dispatch runs, but a `duplicate_declaration` diagnostic
 * is still emitted into the diagnostics array for every collision (the diagnostic
 * is the data; this option is the action).
 *
 * **`'throw'` trade-off**: the throw fires after diagnostics are emitted but
 * before the result is returned, so `'throw'` callers never reach the
 * diagnostics array. Callers that want fail-fast *and* diagnostic access
 * should omit `onDuplicates` and inspect themselves:
 *
 * ```ts
 * const result = await analyze({...});
 * if (hasErrors(result.diagnostics)) throw new Error('analysis errors');
 * ```
 *
 * Or use an `OnDuplicatesCallback` and stash the data before throwing.
 */
export type OnDuplicates = 'throw' | 'warn' | OnDuplicatesCallback;

/**
 * Convenience `OnDuplicatesCallback` that throws on any duplicate.
 *
 * @throws Error listing every duplicate name and module location
 */
export const throwOnDuplicates: OnDuplicatesCallback = (duplicates) => {
	if (duplicates.size === 0) return;
	throw new Error(formatDuplicates(duplicates));
};

const formatDuplicates = (duplicates: Map<string, Array<DuplicateDeclaration>>): string => {
	const details = Array.from(duplicates)
		.map(([name, occurrences]) => {
			const locations = occurrences
				.map(({ declaration, module }) => {
					const lineInfo = declaration.sourceLine !== undefined ? `:${declaration.sourceLine}` : '';
					return `    - ${module}${lineInfo} (${declaration.kind})`;
				})
				.join('\n');
			return `  "${name}" found in:\n${locations}`;
		})
		.join('\n');

	return (
		`Found ${duplicates.size} duplicate declaration name${duplicates.size === 1 ? '' : 's'} across modules. ` +
		'The flat namespace requires unique names. To resolve: ' +
		'(1) rename one of the conflicting declarations, or ' +
		'(2) add /** @nodocs */ to exclude from documentation.\n' +
		details
	);
};

const emitDuplicateDiagnostics = (
	diagnostics: Array<Diagnostic>,
	duplicates: Map<string, Array<DuplicateDeclaration>>
): void => {
	for (const [name, occurrences] of duplicates) {
		const first = occurrences[0]!;
		const modules = occurrences.map((o) => o.module);
		diagnostics.push({
			kind: 'duplicate_declaration',
			file: first.module,
			line: first.declaration.sourceLine,
			message: `Duplicate declaration "${name}" defined in: ${modules.join(', ')}`,
			severity: 'warning',
			declarationName: name,
			modules
		});
	}
};

const dispatchOnDuplicates = (
	mode: OnDuplicates,
	duplicates: Map<string, Array<DuplicateDeclaration>>,
	log?: AnalysisLog
): void => {
	if (duplicates.size === 0) return;
	if (mode === 'throw') {
		throw new Error(formatDuplicates(duplicates));
	}
	const errorLog: Pick<AnalysisLog, 'error'> = log ?? { error: (msg) => console.error(msg) };
	if (mode === 'warn') {
		errorLog.error(formatDuplicates(duplicates));
		return;
	}
	mode(duplicates, errorLog);
};

// Result types

/**
 * Result of `analyze`, `analyzeFromFiles`, and `AnalysisSession.query`.
 *
 * Modules sorted alphabetically by `path`. Diagnostics are query-time
 * (analysis-pass) diagnostics only when produced by `session.query`; one-shot
 * wrappers concatenate ingest + query diagnostics into this same array.
 *
 * ## Schema-validated round-trip
 *
 * The envelope is a Zod schema (`AnalyzeResultJson`) — both fields default to
 * `[]`, so `JSON.stringify(result, compactReplacer)` strips empty arrays on
 * the wire and `AnalyzeResultJson.parse(JSON.parse(json))` restores them.
 * Consumers programmatically ingesting analysis JSON should parse through the
 * schema to get defaults restored; raw-JSON consumers (e.g., `jq`) treat
 * missing keys as null-equivalent (`jq '.diagnostics | length'` returns `0`
 * on `{}`) and don't need the parse step.
 *
 * Construction sites (one-shot wrappers, `session.query`) hand back hand-built
 * objects without re-running `.parse()` — the inner `modules` and
 * `diagnostics` arrays are already Zod-validated upstream, and the envelope
 * schema is the type contract, not a validation gate.
 *
 * See `AnalyzeResultJsonWire` for the serialized input-side shape published on
 * `virtual:svelte-docinfo`.
 */
export const AnalyzeResultJson = z.strictObject({
	modules: z.array(ModuleJson).default([]),
	diagnostics: z.array(Diagnostic).default([])
});
export type AnalyzeResultJson = z.infer<typeof AnalyzeResultJson>;

/**
 * Serialized wire shape of an analysis result, as published by the Vite plugin
 * on `virtual:svelte-docinfo` — the input-side counterpart to
 * `AnalyzeResultJson` (the validated output of `.parse()`).
 *
 * The two fields are deliberately asymmetric:
 *
 * - `modules` is `ModuleJsonInput` (the `z.input` of `ModuleJson`) because the
 *   plugin runs it through `compactReplacer`, which strips `.default([])`
 *   arrays and `.default(false)` booleans. Default-bearing fields therefore
 *   arrive `undefined`.
 * - `diagnostics` is the output `Diagnostic` — the plugin serializes it
 *   without the replacer, and `Diagnostic` has no defaults to strip, so the
 *   array is always present and the shape matches runtime exactly.
 *
 * Consumers restore defaults by parsing through `AnalyzeResultJson`.
 *
 * Note this describes the Vite virtual module specifically. The CLI runs the
 * whole envelope through `compactReplacer`, so its JSON may additionally omit
 * an empty `diagnostics` array — CLI consumers should parse through
 * `AnalyzeResultJson` rather than assume this shape.
 */
export interface AnalyzeResultJsonWire {
	modules: Array<ModuleJsonInput>;
	diagnostics: Array<Diagnostic>;
}

const toModuleJson = (raw: ModuleAnalysis): ModuleJson => {
	const filtered = raw.declarations.filter((d) => !d.nodocs).map((d) => d.declaration);
	// sorted for deterministic, environment-independent output —
	// getExportsOfModule order is a TS implementation detail. Module tie-break
	// because names can collide: a Svelte default-slot re-export re-keys to
	// the component name, which a same-name re-export from another module may
	// also use. The same re-keying can produce exact-duplicate edges
	// (component + same-name script-module export from one file) — deduped on
	// `(name, module)` so those pairs stay unique; the sourceLine tie-break
	// makes the dedup deterministic (smallest line survives)
	const reExports = raw.reExports
		.slice()
		.sort(
			(a, b) =>
				compareStrings(a.name, b.name) ||
				compareStrings(a.module, b.module) ||
				(a.sourceLine ?? 0) - (b.sourceLine ?? 0)
		)
		.filter(
			(r, i, arr) => i === 0 || r.name !== arr[i - 1]!.name || r.module !== arr[i - 1]!.module
		);
	const externalReExports = raw.externalReExports
		.slice()
		.sort(
			(a, b) =>
				compareStrings(a.name, b.name) ||
				compareStrings(a.specifier, b.specifier) ||
				(a.sourceLine ?? 0) - (b.sourceLine ?? 0)
		);
	return ModuleJson.parse({
		path: raw.path,
		declarations: filtered,
		dependencies: raw.dependencies,
		dependents: raw.dependents,
		starExports: raw.starExports,
		reExports,
		externalReExports,
		externalStarExports: raw.externalStarExports,
		...(raw.moduleComment ? { moduleComment: raw.moduleComment } : {})
	});
};

// Module dispatch

/**
 * Analyze a single non-Svelte source file and extract module metadata.
 *
 * @internal Single-module dispatcher used internally by the two-phase
 * orchestrator. Importable from `svelte-docinfo/analyze-core.js` for tests
 * and power users — not part of the stable barrel API and not guaranteed
 * across minor versions.
 *
 * Dispatches on file type:
 * - TypeScript/JS → `analyzeTypescriptModule`
 * - CSS/JSON → minimal module (no declarations, dependency tracking only)
 * - Svelte → `module_skipped: requires_program` (callers using session API
 *   should not reach this path; the session pre-handles Svelte)
 *
 * Returns `undefined` when the file is skipped; the diagnostic is added to
 * `diagnostics` so the caller can keep iterating.
 *
 * `alsoExportedFrom` on returned declarations is always empty from this path —
 * cross-module re-export resolution requires all modules (`mergeReExports`
 * consumes the returned module's `reExports` in phase 2).
 *
 * `aliasRegistry` is optional at this boundary: direct callers assembling
 * modules themselves get written-name recovery only, while `analyzeCore`
 * passes the registry its pre-pass built (see `buildAliasRegistry`).
 */
export const analyzeModule = (
	sourceFile: SourceFileInfo & { dependents?: ReadonlyArray<string> },
	program: ts.Program,
	options: ModuleSourceOptions,
	diagnostics: Array<Diagnostic>,
	log?: AnalysisLog,
	aliasRegistry?: AliasRegistry
): ModuleJson | undefined => {
	const checker = program.getTypeChecker();
	const modulePath = extractPath(sourceFile.id, options);
	const analyzerType = options.getAnalyzerType(sourceFile.id);

	let raw: ModuleAnalysis | undefined;

	if (analyzerType === 'svelte') {
		diagnostics.push({
			kind: 'module_skipped',
			file: modulePath,
			message:
				'Svelte files require program integration. Use createAnalysisSession or analyze()/analyzeFromFiles() instead.',
			severity: 'warning',
			reason: 'requires_program'
		});
		log?.warn(`Svelte file skipped in analyzeModule: ${sourceFile.id}`);
		return undefined;
	} else if (analyzerType === 'typescript') {
		const tsSourceFile = program.getSourceFile(sourceFile.id);
		if (!tsSourceFile) {
			diagnostics.push({
				kind: 'module_skipped',
				file: modulePath,
				// `file` already carries the path, so the message doesn't repeat the
				// absolute id. The log line below keeps it — logs are for
				// developers, diagnostics ship.
				message: `Could not get source file from program: ${modulePath}`,
				severity: 'warning',
				reason: 'not_in_program'
			});
			log?.warn(`Could not get source file from program: ${sourceFile.id}`);
			return undefined;
		}
		raw = analyzeTypescriptModule(
			sourceFile,
			tsSourceFile,
			modulePath,
			checker,
			options,
			diagnostics,
			aliasRegistry
		);
	} else if (analyzerType === 'css' || analyzerType === 'json') {
		const { dependencies, dependents } = extractDependencies(sourceFile, options);
		raw = {
			path: modulePath,
			declarations: [],
			dependencies,
			dependents,
			starExports: [],
			reExports: [],
			externalReExports: [],
			externalStarExports: []
		};
	} else {
		diagnostics.push({
			kind: 'module_skipped',
			file: modulePath,
			message: `No analyzer for file type: ${modulePath}`,
			severity: 'warning',
			reason: 'no_analyzer'
		});
		log?.warn(`No analyzer for file: ${sourceFile.id}`);
		return undefined;
	}

	return toModuleJson(raw);
};

// Core two-phase loop

/**
 * Inputs to `analyzeCore`. The caller (one-shot wrapper or session.query)
 * is responsible for normalizing `sourceOptions`, obtaining the program,
 * and pre-transforming Svelte files into `svelteVirtualFiles`.
 *
 * `transformFailedIds` carries the IDs of `.svelte` files whose svelte2tsx
 * transform threw at ingest. The dispatch synthesizes a placeholder
 * `ModuleJson` (`partial: true`, empty declarations) for each so consumers
 * see the file's existence in `modules` even though analysis couldn't run.
 * Identifying these via a sibling Set keeps `svelteVirtualFiles` a clean
 * "files we can analyze" map; the failure side-channel doesn't pollute it.
 */
export interface AnalyzeCoreInputs {
	sourceFiles: ReadonlyArray<SourceFileInfo>;
	sourceOptions: ModuleSourceOptions;
	program: ts.Program;
	svelteVirtualFiles: ReadonlyMap<string, SvelteVirtualFile>;
	/** Svelte file IDs whose svelte2tsx transform failed at ingest. */
	transformFailedIds?: ReadonlySet<string>;
	/**
	 * Gated Svelte files (owned but failing `isSource` — the `internal/`
	 * convention) whose virtuals are in `svelteVirtualFiles`. Analyzed only
	 * when an emitted component alias references them, as canonical-fill
	 * context for `resolveComponentAliases` — their modules never emit and
	 * their analysis diagnostics are dropped (`partial` on the canonical
	 * propagates to the filled alias instead).
	 */
	contextSvelteFiles?: ReadonlyArray<SourceFileInfo>;
	onDuplicates?: OnDuplicates;
	log?: AnalysisLog;
}

/**
 * Run the two-phase analysis loop on pre-prepared inputs.
 *
 * @internal Shared two-phase orchestrator used internally by `session.query`
 * and the one-shot wrappers. Importable from `svelte-docinfo/analyze-core.js`
 * for tests and power users — not part of the stable barrel API and not
 * guaranteed across minor versions.
 *
 * Phase 1: per-file dispatch (TS / Svelte / CSS / JSON / placeholder for
 * transform-failed Svelte). Phase 2: re-export merge, component-alias fill,
 * sort, duplicate detection. Diagnostic paths are normalized to
 * project-root-relative form before return.
 *
 * Dependents are read from `sourceFile.dependents` (caller-supplied via
 * `extractDependencies`); `analyzeCore` does not compute them. `session.query`
 * runs `computeDependents` on the owned set before invoking this.
 */
/**
 * Analyze the gated Svelte canonicals referenced by an emitted component
 * alias, as `resolveComponentAliases` fill context only (see
 * `AnalyzeCoreInputs.contextSvelteFiles`). Unreferenced files are skipped
 * entirely; analysis diagnostics are dropped — the canonical's `partial`
 * flag propagates through the fill, which is the emitted signal.
 */
const analyzeContextComponents = (
	contextSvelteFiles: ReadonlyArray<SourceFileInfo>,
	emittedModules: ReadonlyArray<ModuleJson>,
	inputs: AnalyzeCoreInputs,
	aliasRegistry: AliasRegistry
): Array<ModuleJson> => {
	const { sourceOptions, program, svelteVirtualFiles } = inputs;
	const referenced = new Set<string>();
	for (const mod of emittedModules) {
		for (const decl of mod.declarations) {
			if (decl.kind === 'component' && decl.aliasOf) referenced.add(decl.aliasOf.module);
		}
	}
	const contextModules: Array<ModuleJson> = [];
	if (referenced.size === 0) return contextModules;
	for (const sourceFile of contextSvelteFiles) {
		const modulePath = extractPath(sourceFile.id, sourceOptions);
		if (!referenced.has(modulePath)) continue;
		const virtualFile = svelteVirtualFiles.get(sourceFile.id);
		if (!virtualFile) continue;
		const droppedDiagnostics: Array<Diagnostic> = [];
		const raw = analyzeSvelteModule(
			sourceFile,
			modulePath,
			program.getTypeChecker(),
			sourceOptions,
			droppedDiagnostics,
			program,
			virtualFile,
			aliasRegistry
		);
		if (raw) contextModules.push(toModuleJson(raw));
	}
	return contextModules;
};

export const analyzeCore = (inputs: AnalyzeCoreInputs): AnalyzeResultJson => {
	const {
		sourceFiles,
		sourceOptions,
		program,
		svelteVirtualFiles,
		transformFailedIds,
		contextSvelteFiles,
		onDuplicates,
		log
	} = inputs;

	const checker = program.getTypeChecker();
	const diagnostics: Array<Diagnostic> = [];

	// Registry pre-pass: register the emitted set's exported lost aliases
	// before any extraction, so every `resolveTypeInfo` call this cycle can
	// consult a complete registry. Svelte modules are reached through their
	// svelte2tsx virtuals (`program.getSourceFile(<.svelte id>)` is undefined);
	// CSS/JSON have no exports and analyzer-less files no program file. Gated
	// context files are deliberately absent — their aliases must not register
	// (emitted references always have a doc page to link).
	const registrySources: Array<AliasRegistrySource> = [];
	for (const sourceFile of sourceFiles) {
		if (transformFailedIds?.has(sourceFile.id)) continue;
		const virtualFile = svelteVirtualFiles.get(sourceFile.id);
		const programFile = virtualFile
			? program.getSourceFile(virtualFile.virtualPath)
			: sourceOptions.getAnalyzerType(sourceFile.id) === 'typescript'
				? program.getSourceFile(sourceFile.id)
				: undefined;
		if (!programFile) continue;
		registrySources.push({
			sourceFile: programFile,
			modulePath: extractPath(sourceFile.id, sourceOptions)
		});
	}
	const aliasRegistry = buildAliasRegistry(registrySources, checker);

	const modules: Array<ModuleJson> = [];

	// Phase 1: analyze every module (forward re-export edges land on `ModuleJson.reExports`)
	for (const sourceFile of sourceFiles) {
		// Failed-transform Svelte file: synthesize placeholder ModuleJson so
		// the modules array reflects the full owned set. The originating
		// transform_failed ingest diagnostic carries the cause; this slot
		// is purely structural.
		if (transformFailedIds?.has(sourceFile.id)) {
			const modulePath = extractPath(sourceFile.id, sourceOptions);
			const componentName = getComponentName(modulePath);
			const { dependencies, dependents } = extractDependencies(sourceFile, sourceOptions);
			modules.push(
				ModuleJson.parse({
					path: modulePath,
					declarations: [],
					dependencies,
					dependents,
					starExports: [],
					partial: true
				})
			);
			log?.warn(`Svelte component ${componentName} marked partial (transform failed at ingest)`);
			continue;
		}

		let mod: ModuleJson | undefined;

		const virtualFile = svelteVirtualFiles.get(sourceFile.id);
		if (virtualFile) {
			const modulePath = extractPath(sourceFile.id, sourceOptions);
			const raw = analyzeSvelteModule(
				sourceFile,
				modulePath,
				checker,
				sourceOptions,
				diagnostics,
				program,
				virtualFile,
				aliasRegistry
			);
			if (raw) {
				mod = toModuleJson(raw);
			} else {
				log?.error(`Svelte module analysis failed: ${sourceFile.id}`);
			}
		} else {
			mod = analyzeModule(sourceFile, program, sourceOptions, diagnostics, log, aliasRegistry);
		}

		if (!mod) continue;

		modules.push(mod);
	}

	// Phase 1.5: gated Svelte canonicals as fill context — kept out of
	// `mergeReExports` (their edges would back-link modules absent from
	// output) and out of the emitted set.
	const contextModules = contextSvelteFiles?.length
		? analyzeContextComponents(contextSvelteFiles, modules, inputs, aliasRegistry)
		: [];

	// Phase 2a: build alsoExportedFrom arrays from the modules' forward edges
	const mergedModules = mergeReExports(modules);
	// Phase 2b: fill component-only fields on renamed component aliases —
	// canonical components are only fully populated after phase 1 finishes.
	// Gated canonicals extend the lookup without joining the output.
	const resolvedModules = resolveComponentAliases(mergedModules, contextModules);

	const sortedModules = sortModules(resolvedModules);

	// Always run duplicate detection so a `duplicate_declaration` diagnostic
	// reaches consumers regardless of `onDuplicates`. The `onDuplicates`
	// callback/shortcut still fires for callers that want fail-fast or custom
	// handling — diagnostics is the data, `onDuplicates` is the action.
	const duplicates = findDuplicates(sortedModules);
	emitDuplicateDiagnostics(diagnostics, duplicates);
	if (onDuplicates) {
		dispatchOnDuplicates(onDuplicates, duplicates, log);
	}

	normalizeModulePathsInTypes(sortedModules, sourceOptions, program);
	normalizeDiagnosticPaths(diagnostics, sourceOptions.projectRoot);

	return {
		modules: sortedModules,
		diagnostics
	};
};

/**
 * Normalize the paths a `Diagnostic` carries to project-root-relative form,
 * in place.
 *
 * Producers inside the analysis pipeline can write absolute paths or virtual
 * paths (svelte2tsx output like `Foo.svelte.__svelte2tsx__.ts`). This pass
 * collapses both to the public contract: a path relative to `projectRoot`
 * with no leading slash and no `./` prefix. A file outside the root gets the
 * `../` form, matching module paths in printed type text — and making the
 * documented "rejoin with `projectRoot` to get an absolute path" actually
 * hold for it, which dropping the leading slash did not.
 *
 * `message` gets the same treatment as `file`, by textual substitution. A
 * message is free-form, and not every path in one comes from a field this
 * pass can see — `import_parse_failed` wraps an es-module-lexer error that
 * embeds the file name itself. Scrubbing here means the contract holds for
 * the whole record rather than one field, so a producer can't reintroduce an
 * absolute path through prose.
 *
 * Exposed for build-tool integrations that bypass the session and collect
 * their own discovery/dep diagnostics — they need the same normalization to
 * match the public contract.
 *
 * @mutates diagnostics — rewrites each diagnostic's `file` and `message`
 */
export const normalizeDiagnosticPaths = (
	diagnostics: Array<Diagnostic>,
	projectRoot: string
): void => {
	const root = projectRoot.endsWith('/') ? projectRoot.slice(0, -1) : projectRoot;
	const prefix = root + '/';
	for (const d of diagnostics) {
		if (d.message.includes(prefix) || d.message.includes(SVELTE_VIRTUAL_SUFFIX)) {
			d.message = d.message.split(prefix).join('').split(SVELTE_VIRTUAL_SUFFIX).join('');
		}
		// Posixify so producers that emitted native-separator paths (e.g., a
		// custom discovery layer building `path.relative` results on Windows)
		// match the POSIX prefix derived from the normalized projectRoot.
		let file = toPosixPath(stripVirtualSuffix(d.file));
		if (file.startsWith(prefix)) {
			file = file.slice(prefix.length);
		} else if (isAbsolutePosixPath(file)) {
			// Outside the root. Relativize rather than dropping the leading slash,
			// which produced a string that reads as root-relative but resolves
			// somewhere else entirely. A path already relative is left alone —
			// `relative` would resolve it against `cwd`.
			file = toPosixPath(relative(root, file));
		}
		d.file = file;
	}
};

/**
 * Extensions TypeScript elides when it prints a module specifier inside a type
 * (`typeof import("…/dep")` for `…/dep.ts`), in module-resolution preference
 * order.
 *
 * Order encodes preference, not match order: `elidedExtensionOf` takes the
 * *longest* match, so `.d.ts` beats `.ts` on `b.d.ts` regardless of position.
 * That frees the order to break the tie when two program files elide to the
 * same path — which is the only thing standing between this pass and a
 * dependence on `program.getSourceFiles()` iteration order, in a pass whose
 * whole purpose is output that doesn't vary between machines.
 */
const ELIDED_MODULE_EXTENSIONS = [
	'.ts',
	'.tsx',
	'.mts',
	'.cts',
	'.d.ts',
	'.d.mts',
	'.d.cts',
	'.js',
	'.jsx',
	'.mjs',
	'.cjs'
];

/** The longest elided extension `path` ends with, or `undefined`. */
const elidedExtensionOf = (path: string): string | undefined => {
	let longest: string | undefined;
	for (const ext of ELIDED_MODULE_EXTENSIONS) {
		if (path.endsWith(ext) && (longest === undefined || ext.length > longest.length)) {
			longest = ext;
		}
	}
	return longest;
};

const stripElidedExtension = (path: string): string => {
	const ext = elidedExtensionOf(path);
	return ext === undefined ? path : path.slice(0, -ext.length);
};

/** Lower wins. Ranks two files that elide to the same path by resolution preference. */
const elidedExtensionRank = (path: string): number => {
	const ext = elidedExtensionOf(path);
	return ext === undefined
		? ELIDED_MODULE_EXTENSIONS.length
		: ELIDED_MODULE_EXTENSIONS.indexOf(ext);
};

/**
 * Matches a double-quoted absolute path inside printed type text.
 *
 * Two shapes carry one: the checker's `import("…")` form, and a `TypeJson`
 * reference whose `name` is the module symbol's own quoted path.
 *
 * The absolute-path alternation mirrors `isAbsolutePosixPath` — same rule, but
 * this one has to match *inside* a larger string rather than test a whole one.
 */
const QUOTED_ABSOLUTE_PATH_RE = /"((?:\/|[A-Za-z]:\/)[^"\n]*)"/g;

/**
 * Keys holding author-written text or already-relative paths, never printed
 * type text. Skipped by the walk so a doc comment, a raw `defaultValue`, or a
 * written heritage clause (`extends`, `implements`, `intersects` — all
 * `getText()` of the written node) can't be rewritten.
 *
 * A denylist rather than an allowlist of type-bearing keys, deliberately: the
 * failure this pass exists to prevent is a *missed* type field, so it should
 * fail open. A new author-text field added later gets walked, but the rewrite
 * still only fires on a quoted absolute path resolving to a loaded file — the
 * resolution check, not this list, is the real guard.
 */
const NON_TYPE_TEXT_KEYS: ReadonlySet<string> = new Set([
	'dependencies',
	'dependents',
	'deprecatedMessage',
	'description',
	'defaultValue',
	'docComment',
	'examples',
	'extends',
	'externalStarExports',
	'implements',
	'internalMessage',
	'intersects',
	'module',
	'moduleComment',
	'mutates',
	'path',
	'propertyDescriptions',
	'returnDescription',
	'seeAlso',
	'since',
	'specifier',
	'starExports',
	'throws'
]);

/**
 * Build the printed-path → public-path mapper for one analysis run.
 *
 * Tiers, in order: a module in this output emits its `ModuleJson.path`; a
 * package emits the tail after the last `node_modules/`; everything else is
 * relative to `projectRoot`, which covers both an in-project file that emits
 * no module and an out-of-project one (`../sibling/src/x.ts`).
 *
 * The relative form is not *guaranteed* stable across machines — a target with
 * no near common ancestor gets a `../` run whose length tracks how deep
 * `projectRoot` happens to sit. It's still strictly better than the absolute
 * path it replaces: stable whenever the layout is (the sibling-repo and
 * monorepo cases this actually arises from), and it never carries a home
 * directory.
 */
const createModulePathNormalizer = (
	modules: ReadonlyArray<ModuleJson>,
	options: ModuleSourceOptions,
	program: ts.Program
): ((printed: string) => string) => {
	const modulePaths = new Set(modules.map((m) => m.path));
	const programFiles = new Set<string>();
	// Recovers the extension the checker elided. Two program files can elide to
	// the same path (`a.ts` beside `a.d.ts`), and picking the wrong one costs
	// more than it looks: `byModule` is keyed on the resolved path, so a wrong
	// pick *misses* tier 1 and silently degrades to a root-relative path. Ranked
	// by resolution preference rather than first-wins, so the choice doesn't
	// ride on `getSourceFiles()` order.
	const byElidedExtension = new Map<string, string>();
	// Resolved absolute → `ModuleJson.path`, built from the program files that
	// actually became modules. Keyed on the *resolved* path — the same form the
	// lookup computes — so no extension guess enters tier 1. Keying on the
	// elided form instead would collide `Foo.svelte` with a sibling
	// `Foo.svelte.ts` (the Svelte 5 rune-module idiom), and let a non-module
	// `.d.ts` sibling claim a module's key.
	const byModule = new Map<string, string>();
	for (const sourceFile of program.getSourceFiles()) {
		const fileName = toPosixPath(sourceFile.fileName);
		programFiles.add(fileName);
		const elided = stripElidedExtension(fileName);
		const incumbent = byElidedExtension.get(elided);
		if (incumbent === undefined || elidedExtensionRank(fileName) < elidedExtensionRank(incumbent)) {
			byElidedExtension.set(elided, fileName);
		}
		const real = toPosixPath(stripVirtualSuffix(fileName));
		const modulePath = extractPath(real, options);
		if (modulePaths.has(modulePath)) byModule.set(real, modulePath);
	}

	const cache = new Map<string, string>();

	return (printed) => {
		const cached = cache.get(printed);
		if (cached !== undefined) return cached;

		const posix = toPosixPath(printed);
		// Only rewrite a path naming a file this program actually loaded. A
		// string-literal type that happens to look like one (`type P = "/usr/bin"`)
		// resolves to nothing and is left alone.
		const resolved = programFiles.has(posix) ? posix : byElidedExtension.get(posix);
		if (resolved === undefined) {
			cache.set(printed, printed);
			return printed;
		}
		// Strip after resolving: the checker elides the virtual's `.ts`, so the
		// printed form (`Foo.svelte.__svelte2tsx__`) doesn't carry the full suffix.
		const real = toPosixPath(stripVirtualSuffix(resolved));

		const modulePath = byModule.get(real);
		// Last, not first: pnpm nests the real package under its store entry
		// (`node_modules/.pnpm/pkg@1/node_modules/pkg/…`), and a hoisted monorepo
		// dep can sit above `projectRoot` — both want the innermost segment. This
		// tier running before the `projectRoot` one is what covers out-of-root
		// dependencies, leaving only out-of-root *source* to fall through.
		const packageIndex = real.lastIndexOf('/node_modules/');
		let normalized: string;
		if (modulePath !== undefined) {
			normalized = modulePath;
		} else if (packageIndex !== -1) {
			normalized = real.slice(packageIndex + '/node_modules/'.length);
		} else {
			// One `relative` covers both remaining tiers: in-project files come
			// back root-relative, out-of-project ones as `../…`. The `../` prefix
			// is a usable marker — a `ModuleJson.path` can never start with it
			// (out-of-root source paths throw in `normalizeSourceOptions`) and
			// neither can a package specifier, so it reads unambiguously as
			// "outside this project."
			normalized = toPosixPath(relative(options.projectRoot, real));
		}

		cache.set(printed, normalized);
		return normalized;
	};
};

/**
 * Idempotent: a rewritten string no longer matches, because every tier but the
 * out-of-project one emits a relative path and the pattern requires a leading
 * `/` (or drive letter). Load-bearing — phase 2 shares structure between
 * modules (`mergeReExports`, `resolveComponentAliases` copy only what changes),
 * so one array can be reached through more than one declaration.
 */
const replaceQuotedPaths = (text: string, rewrite: (printed: string) => string): string => {
	if (!text.includes('"')) return text;
	return text.replace(QUOTED_ABSOLUTE_PATH_RE, (match, path: string) => {
		const normalized = rewrite(path);
		return normalized === path ? match : `"${normalized}"`;
	});
};

const rewriteTypeText = (value: unknown, rewrite: (printed: string) => string): void => {
	if (Array.isArray(value)) {
		for (let i = 0; i < value.length; i++) {
			const entry: unknown = value[i];
			if (typeof entry === 'string') {
				value[i] = replaceQuotedPaths(entry, rewrite);
			} else {
				rewriteTypeText(entry, rewrite);
			}
		}
		return;
	}
	if (value === null || typeof value !== 'object') return;
	const record = value as Record<string, unknown>;
	// A `TypeJson` literal node's `text`/`value` are the author's literal type,
	// not a printed module reference.
	if (record.kind === 'literal') return;
	for (const key of Object.keys(record)) {
		if (NON_TYPE_TEXT_KEYS.has(key)) continue;
		const entry = record[key];
		if (typeof entry === 'string') {
			record[key] = replaceQuotedPaths(entry, rewrite);
		} else {
			rewriteTypeText(entry, rewrite);
		}
	}
};

/**
 * Normalize the absolute module paths TypeScript embeds in printed type text,
 * in place.
 *
 * The checker prints a module object as `typeof import("<absolute path>")`,
 * which reaches output through every checker-printed field — `typeSignature`
 * on declarations and members, `returnType`, and the `text`/`name` of a
 * `TypeJson` node. Left alone it makes output machine-dependent (two checkouts
 * of the same source produce different bytes), publishes local filesystem
 * paths on any site that renders `typeSignature`, and exposes the svelte2tsx
 * virtual suffix that `stripVirtualSuffix` exists to hide.
 *
 * A path that resolves to a module in this output is rewritten to that
 * module's `ModuleJson.path`, so the string doubles as a lookup key: a
 * consumer linkifies with `modules.find((m) => m.path === s)` and reads a miss
 * as "not a module here." See `createModulePathNormalizer` for the remaining
 * tiers.
 *
 * Runs as a whole-output pass rather than at the ~20 `typeToString` /
 * `signatureToString` call sites, so a new printing site can't miss it.
 *
 * @mutates modules — rewrites printed type text on declarations and members
 */
export const normalizeModulePathsInTypes = (
	modules: Array<ModuleJson>,
	options: ModuleSourceOptions,
	program: ts.Program
): void => {
	const rewrite = createModulePathNormalizer(modules, options, program);
	for (const mod of modules) {
		rewriteTypeText(mod, rewrite);
	}
};
