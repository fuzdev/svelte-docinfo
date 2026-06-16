/**
 * One-shot analysis wrappers — `analyze` and `analyzeFromFiles`.
 *
 * Both wrap a single-use `AnalysisSession`: `createSession → setFiles → query
 * → dispose`. Incremental consumers (Vite plugin, LSP) should use
 * `createAnalysisSession` directly so parsed ASTs and svelte2tsx output
 * survive between calls.
 *
 * - `analyzeFromFiles` — high-level: file discovery from disk + dependency
 *   resolution + analysis. Recommended for CLI / build-time generation.
 * - `analyze` — mid-level: caller supplies `SourceFileInfo[]`. For build-tool
 *   integrations that own discovery but don't run incrementally.
 *
 * @see `session.ts` for the persistent session API
 * @see `analyze-core.ts` for the two-phase orchestrator
 *
 * @module
 */

import {errorsOf, formatDiagnostic, warningsOf} from './diagnostics.ts';
import type {AnalysisLog} from './log.ts';
import {createAnalysisSession, type AnalysisSession} from './session.ts';
import {
	createSourceOptions,
	type ModuleSourceOptions,
	type SourceOptionsDefaults,
} from './source-config.ts';
import {discoverSourceFiles, type Discovery} from './discovery.ts';
import {noDepsResolver, type ResolveImport} from './dep-resolver.ts';
import {
	normalizeDiagnosticPaths,
	type AnalyzeResultJson,
	type OnDuplicates,
} from './analyze-core.ts';
import type {SourceFileInfo} from './source.ts';

// analyze: one-shot, caller-supplied sourceFiles

/**
 * Options for `analyze`.
 *
 * Requires pre-loaded `SourceFileInfo` arrays — use `analyzeFromFiles` for
 * automatic file discovery and loading from disk, or `createAnalysisSession`
 * for incremental use.
 */
export interface AnalyzeOptions {
	/** Source files to analyze (must have content loaded). */
	sourceFiles: ReadonlyArray<SourceFileInfo>;
	/** Module source options for path extraction and source filtering. */
	sourceOptions: ModuleSourceOptions;
	/** Behavior when duplicate declaration names are found across modules. */
	onDuplicates?: OnDuplicates;
	/** Optional logger for status and diagnostic messages. */
	log?: AnalysisLog;
	/**
	 * Optional custom import resolver for the session default — a bare
	 * `ResolveImportFn` or a token-paired `ImportResolver` (see `ResolveImport`).
	 * For one-shot `analyze()` the session is single-use, so a bare function is
	 * the natural form; pass an `ImportResolver` with a stable `identity` only if
	 * you have a reason to control the cache scope.
	 */
	resolveImport?: ResolveImport;
}

/**
 * Analyze library source files and extract metadata (one-shot).
 *
 * Wraps a single-use `AnalysisSession`. For repeated analyses of the same
 * source set (e.g., a Vite plugin reacting to file edits), use
 * `createAnalysisSession` directly.
 *
 * @returns analyzed modules (sorted alphabetically) + concatenated ingest +
 *   query diagnostics
 * @throws Error if `sourceOptions` validation fails or `tsconfig.json` is
 *   missing at `projectRoot`. Also propagates `onDuplicates: 'throw'` errors.
 */
export const analyze = async (options: AnalyzeOptions): Promise<AnalyzeResultJson> => {
	const session = createAnalysisSession({
		sourceOptions: options.sourceOptions,
		log: options.log,
		resolveImport: options.resolveImport,
	});
	try {
		const ingest = await session.setFiles(options.sourceFiles);
		const query = session.query({onDuplicates: options.onDuplicates, log: options.log});
		// Concat is safe by spec — ingest diagnostics are paths-normalized in
		// session.setFiles; query diagnostics are normalized in analyze-core.
		return {
			modules: query.modules,
			diagnostics: [...ingest.diagnostics, ...query.diagnostics],
		};
	} finally {
		session.dispose();
	}
};

// analyzeFromFiles: high-level disk-discovery wrapper

/**
 * Options for `analyzeFromFiles`.
 *
 * @see `AnalyzeOptions` for the build-tool-integration API where you supply
 *   `sourceFiles` and a fully-formed `sourceOptions: ModuleSourceOptions` directly.
 */
export interface AnalyzeFromFilesOptions {
	/** Absolute path to project root directory. */
	projectRoot: string;
	/** Partial overrides for default source options (SvelteKit `src/lib` layout). */
	sourceOptions?: Partial<SourceOptionsDefaults>;
	/** Behavior when duplicate declaration names are found across modules. */
	onDuplicates?: OnDuplicates;
	/** Optional logger for status and diagnostic messages. */
	log?: AnalysisLog;
	/**
	 * Glob patterns to include (relative to `projectRoot`).
	 *
	 * Filters glob-based discovery. Providing `include` under the default
	 * `discovery: 'auto'` collapses the chain to glob immediately; combining
	 * with `discovery: 'exports'` throws.
	 *
	 * When omitted, the glob fallback derives an include from
	 * `sourceOptions.sourcePaths` via `deriveIncludePatterns`, so custom
	 * `sourcePaths` (e.g., `['packages/foo']`) survive the fallback instead of
	 * silently defaulting to `src/lib`.
	 */
	include?: Array<string>;
	/** Glob patterns to exclude — fully replaces `sourceOptions.exclude` (no merge). */
	exclude?: Array<string>;
	/**
	 * Whether to resolve import dependencies (default `true`).
	 *
	 * When `false`, the session uses a no-op resolver that always returns
	 * `null`, so `ModuleJson.dependencies` / `dependents` stay empty.
	 * `analyzeFromFiles`'s discovery layer does not pre-populate
	 * `SourceFileInfo.dependencies`, so the session's pre-resolved fast path
	 * isn't reachable through this API — to exercise it, drive `analyze` or
	 * `createAnalysisSession` directly with files whose `dependencies` field
	 * is already filled in by your build tool.
	 *
	 * @default `true`
	 */
	resolveDependencies?: boolean;
	/**
	 * Optional custom import resolver — a bare `ResolveImportFn` or a
	 * token-paired `ImportResolver` (see `ResolveImport`). One-shot use doesn't
	 * benefit from a stable cache identity, so the bare function form is the
	 * natural choice here; for long-lived consumers (Vite plugin, LSP) construct
	 * an `ImportResolver` with a stable `identity` and pass it via
	 * `createAnalysisSession` so cache hits survive across calls.
	 *
	 * Cannot be combined with `resolveDependencies: false` — resolution is then
	 * off, so the resolver would never be consulted; passing both throws.
	 */
	resolveImport?: ResolveImport;
	/** Discovery strategy for source files. @default 'auto' */
	discovery?: Discovery;
	/** Dist directory name for exports-based discovery. @default 'dist' */
	distDir?: string;
}

/**
 * Analyze a library from files on disk with automatic file discovery.
 *
 * Recommended high-level API for one-shot use (CLI, build-time generation):
 *
 * 1. **Discovery** — `discoverSourceFiles` (exports-first, glob fallback)
 * 2. **Ingest** — push discovered files into a single-use session
 * 3. **Analysis** — `session.query()`
 *
 * @returns analyzed modules + concatenated ingest, discovery, and query diagnostics
 * @throws Error if `sourceOptions` validation fails or `tsconfig.json` is missing
 */
export const analyzeFromFiles = async (
	options: AnalyzeFromFilesOptions,
): Promise<AnalyzeResultJson> => {
	const {
		projectRoot,
		include,
		exclude,
		resolveDependencies: shouldResolveDependencies = true,
		resolveImport,
		sourceOptions,
		onDuplicates,
		log,
		discovery,
		distDir,
	} = options;

	// A custom resolver with resolution turned off is a contradiction — the
	// resolver would never be consulted. Fail fast rather than silently dropping
	// it (mirrors the `discovery: 'exports'` + `include` config-error throw).
	if (!shouldResolveDependencies && resolveImport !== undefined) {
		throw new Error(
			'`resolveImport` cannot be combined with `resolveDependencies: false` — ' +
				'dependency resolution is disabled, so the resolver would never be consulted. ' +
				'Remove `resolveImport`, or set `resolveDependencies: true` (the default).',
		);
	}

	// Top-level `exclude` is an ergonomic shortcut that fully replaces
	// `sourceOptions.exclude` (no array merge). Apply before
	// `createSourceOptions` so the normalized options carry a single source
	// of truth.
	const mergedSourceOptions = exclude !== undefined ? {...sourceOptions, exclude} : sourceOptions;
	const resolvedSourceOptions = createSourceOptions(projectRoot, mergedSourceOptions);
	const normalizedProjectRoot = resolvedSourceOptions.projectRoot;

	// Step 1: discover files.
	const {files: discoveredFiles, diagnostics: discoveryDiagnostics} = await discoverSourceFiles({
		sourceOptions: resolvedSourceOptions,
		include,
		discovery,
		distDir,
		log,
	});

	// Step 2: build the session-default resolver. When dep-resolution is
	// disabled, install the shared no-deps resolver so the session's lex+resolve
	// passes surface no edges (faster than relying on the default resolver to
	// return null for everything). Otherwise forward the caller's resolver — the
	// session normalizes the `ResolveImport` union (bare fn or token-paired) and
	// falls back to its TS+tsconfig default when undefined.
	const sessionResolver: ResolveImport | undefined = shouldResolveDependencies
		? resolveImport
		: noDepsResolver;

	// Step 3: ingest + analyze via single-use session.
	const session: AnalysisSession = createAnalysisSession({
		sourceOptions: resolvedSourceOptions,
		log,
		resolveImport: sessionResolver,
	});
	let result: AnalyzeResultJson;
	try {
		const ingest = await session.setFiles(discoveredFiles);
		const query = session.query({onDuplicates, log});
		result = {
			modules: query.modules,
			diagnostics: [...ingest.diagnostics, ...query.diagnostics],
		};
	} finally {
		session.dispose();
	}

	// Merge discovery diagnostics. `analyzeCore` and the session both already
	// normalized their own; normalize discovery in place (idempotent for paths
	// already project-relative) and append.
	normalizeDiagnosticPaths(discoveryDiagnostics, normalizedProjectRoot);
	for (const d of discoveryDiagnostics) result.diagnostics.push(d);

	if (log && shouldResolveDependencies) {
		const totalDeps = result.modules.reduce((sum: number, m) => sum + m.dependencies.length, 0);
		log.info(`Resolved ${totalDeps} module dependency edges`);
	}

	if (log && result.diagnostics.length > 0) {
		const errors = errorsOf(result.diagnostics);
		const warnings = warningsOf(result.diagnostics);

		if (errors.length > 0) {
			log.error(`Analysis completed with ${errors.length} error(s):`);
			for (const diagnostic of errors) {
				log.error(`  ${formatDiagnostic(diagnostic)}`);
			}
		}

		if (warnings.length > 0) {
			log.warn(`Analysis completed with ${warnings.length} warning(s):`);
			for (const diagnostic of warnings) {
				log.warn(`  ${formatDiagnostic(diagnostic)}`);
			}
		}
	}

	return result;
};
