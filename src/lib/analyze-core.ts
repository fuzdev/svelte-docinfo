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
 *
 * @internal — module split is implementation detail; consumers go through
 * `analyze.ts` / `session.ts` for the stable surface.
 *
 * @module
 */

import ts from 'typescript';
import {z} from 'zod';

import {ModuleJson, type ModuleJsonInput} from './types.js';
import type {ModuleAnalysis} from './declaration-build.js';
import {Diagnostic} from './diagnostics.js';
import type {AnalysisLog} from './log.js';
import {analyzeTypescriptModule} from './typescript-exports.js';
import {analyzeSvelteModule, type SvelteVirtualFile} from './svelte.js';
import {stripVirtualSuffix, type SourceFileInfo, getComponentName} from './source.js';
import {type ModuleSourceOptions, extractPath, extractDependencies} from './source-config.js';
import {toPosixPath} from './paths.js';
import {
	sortModules,
	findDuplicates,
	mergeReExports,
	resolveComponentAliases,
	compareStrings,
	type DuplicateDeclaration,
} from './postprocess.js';

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
	log: Pick<AnalysisLog, 'error'>,
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
				.map(({declaration, module}) => {
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
	duplicates: Map<string, Array<DuplicateDeclaration>>,
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
			modules,
		});
	}
};

const dispatchOnDuplicates = (
	mode: OnDuplicates,
	duplicates: Map<string, Array<DuplicateDeclaration>>,
	log?: AnalysisLog,
): void => {
	if (duplicates.size === 0) return;
	if (mode === 'throw') {
		throw new Error(formatDuplicates(duplicates));
	}
	const errorLog: Pick<AnalysisLog, 'error'> = log ?? {error: (msg) => console.error(msg)};
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
	diagnostics: z.array(Diagnostic).default([]),
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
				(a.sourceLine ?? 0) - (b.sourceLine ?? 0),
		)
		.filter(
			(r, i, arr) => i === 0 || r.name !== arr[i - 1]!.name || r.module !== arr[i - 1]!.module,
		);
	const externalReExports = raw.externalReExports
		.slice()
		.sort(
			(a, b) =>
				compareStrings(a.name, b.name) ||
				compareStrings(a.specifier, b.specifier) ||
				(a.sourceLine ?? 0) - (b.sourceLine ?? 0),
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
		...(raw.moduleComment ? {moduleComment: raw.moduleComment} : {}),
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
 */
export const analyzeModule = (
	sourceFile: SourceFileInfo & {dependents?: ReadonlyArray<string>},
	program: ts.Program,
	options: ModuleSourceOptions,
	diagnostics: Array<Diagnostic>,
	log?: AnalysisLog,
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
			reason: 'requires_program',
		});
		log?.warn(`Svelte file skipped in analyzeModule: ${sourceFile.id}`);
		return undefined;
	} else if (analyzerType === 'typescript') {
		const tsSourceFile = program.getSourceFile(sourceFile.id);
		if (!tsSourceFile) {
			diagnostics.push({
				kind: 'module_skipped',
				file: modulePath,
				message: `Could not get source file from program: ${sourceFile.id}`,
				severity: 'warning',
				reason: 'not_in_program',
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
		);
	} else if (analyzerType === 'css' || analyzerType === 'json') {
		const {dependencies, dependents} = extractDependencies(sourceFile, options);
		raw = {
			path: modulePath,
			declarations: [],
			dependencies,
			dependents,
			starExports: [],
			reExports: [],
			externalReExports: [],
			externalStarExports: [],
		};
	} else {
		diagnostics.push({
			kind: 'module_skipped',
			file: modulePath,
			message: `No analyzer for file type: ${sourceFile.id}`,
			severity: 'warning',
			reason: 'no_analyzer',
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
export const analyzeCore = (inputs: AnalyzeCoreInputs): AnalyzeResultJson => {
	const {
		sourceFiles,
		sourceOptions,
		program,
		svelteVirtualFiles,
		transformFailedIds,
		onDuplicates,
		log,
	} = inputs;

	const checker = program.getTypeChecker();
	const diagnostics: Array<Diagnostic> = [];

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
			const {dependencies, dependents} = extractDependencies(sourceFile, sourceOptions);
			modules.push(
				ModuleJson.parse({
					path: modulePath,
					declarations: [],
					dependencies,
					dependents,
					starExports: [],
					partial: true,
				}),
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
			);
			if (raw) {
				mod = toModuleJson(raw);
			} else {
				log?.error(`Svelte module analysis failed: ${sourceFile.id}`);
			}
		} else {
			mod = analyzeModule(sourceFile, program, sourceOptions, diagnostics, log);
		}

		if (!mod) continue;

		modules.push(mod);
	}

	// Phase 2a: build alsoExportedFrom arrays from the modules' forward edges
	mergeReExports(modules);
	// Phase 2b: fill component-only fields on renamed component aliases —
	// canonical components are only fully populated after phase 1 finishes.
	resolveComponentAliases(modules);

	const sortedModules = sortModules(modules);

	// Always run duplicate detection so a `duplicate_declaration` diagnostic
	// reaches consumers regardless of `onDuplicates`. The `onDuplicates`
	// callback/shortcut still fires for callers that want fail-fast or custom
	// handling — diagnostics is the data, `onDuplicates` is the action.
	const duplicates = findDuplicates(sortedModules);
	emitDuplicateDiagnostics(diagnostics, duplicates);
	if (onDuplicates) {
		dispatchOnDuplicates(onDuplicates, duplicates, log);
	}

	normalizeDiagnosticPaths(diagnostics, sourceOptions.projectRoot);

	return {
		modules: sortedModules,
		diagnostics,
	};
};

/**
 * Normalize `Diagnostic.file` to project-root-relative form, in place.
 *
 * Producers inside the analysis pipeline can write absolute paths or virtual
 * paths (svelte2tsx output like `Foo.svelte.__svelte2tsx__.ts`). This pass
 * collapses both to the public contract: a path relative to `projectRoot`
 * with no leading slash and no `./` prefix.
 *
 * Exposed for build-tool integrations that bypass the session and collect
 * their own discovery/dep diagnostics — they need the same normalization to
 * match the public contract.
 *
 * @mutates diagnostics — rewrites each diagnostic's `file` field
 */
export const normalizeDiagnosticPaths = (
	diagnostics: Array<Diagnostic>,
	projectRoot: string,
): void => {
	const prefix = projectRoot.endsWith('/') ? projectRoot : projectRoot + '/';
	for (const d of diagnostics) {
		// Posixify so producers that emitted native-separator paths (e.g., a
		// custom discovery layer building `path.relative` results on Windows)
		// match the POSIX prefix derived from the normalized projectRoot.
		let file = toPosixPath(stripVirtualSuffix(d.file));
		if (file.startsWith(prefix)) {
			file = file.slice(prefix.length);
		} else if (file.startsWith('/')) {
			// Absolute path outside projectRoot — drop leading slash so display
			// stays consistent.
			file = file.slice(1);
		}
		d.file = file;
	}
};
