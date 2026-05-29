/**
 * Source file discovery — exports-first with glob fallback.
 *
 * Used by `analyzeFromFiles` to locate source files from a project root.
 * Build tool integrations using `analyze` should construct `SourceFileInfo[]`
 * from their own module graph instead.
 *
 * @see `exports.ts` for `discoverFromExports` (package.json exports → source files)
 * @see `files.ts` for `globFiles` (glob-based discovery)
 *
 * @module
 */

import type {SourceFileInfo} from './source.js';
import {type ModuleSourceOptions, getSourceRoot} from './source-config.js';
import type {Diagnostic} from './diagnostics.js';
import type {AnalysisLog} from './log.js';
import {globFiles, deriveIncludePatterns} from './files.js';
import {discoverFromExports} from './exports.js';

/**
 * Discovery strategy for source files.
 *
 * - `'auto'` (default) — try package.json `exports` first, fall back to glob
 *   patterns when `exports` is missing or resolves to nothing
 * - `'exports'` — package.json `exports` only, **throw** if `exports` is missing
 *   or resolves to no source files (strict mode for libraries that should
 *   always declare their public surface via `exports`)
 * - `'glob'` — skip `exports` entirely, use glob patterns
 *
 * Providing `include` patterns implies `'glob'` semantics regardless of mode
 * — when `discovery: 'auto'` and `include` is set, the auto fallback chain
 * collapses to glob immediately. Combining `discovery: 'exports'` with
 * `include` is a configuration error (the modes are contradictory) and
 * throws at discovery time.
 */
export type Discovery = 'auto' | 'exports' | 'glob';

/** Options for `discoverSourceFiles`. */
export interface DiscoverSourceFilesOptions {
	/**
	 * Source options used to resolve the source directory for exports-based discovery.
	 *
	 * `sourceOptions.projectRoot` is the resolution base for `include` globs and the
	 * `sourceOptions.exclude` glob patterns. Build via `createSourceOptions` (which
	 * normalizes) or pass a normalized return from `normalizeSourceOptions`.
	 *
	 * `sourceOptions.exclude` is the single source of truth for exclusion globs —
	 * applied at both this discovery stage and analysis time (via `isSource()`).
	 */
	sourceOptions: ModuleSourceOptions;

	/**
	 * Glob patterns to include (relative to `projectRoot`).
	 *
	 * Filter for glob-based discovery. When `discovery` is `'auto'` (default),
	 * providing `include` collapses the chain to glob immediately. Combining
	 * `include` with `discovery: 'exports'` throws.
	 *
	 * When omitted, the glob fallback derives an include pattern from
	 * `sourceOptions.sourcePaths` via `deriveIncludePatterns`, so custom
	 * `sourcePaths` (e.g., `['packages/foo']`) discover files instead of
	 * silently defaulting to `src/lib`.
	 */
	include?: Array<string>;

	/**
	 * Discovery strategy.
	 *
	 * @default 'auto'
	 * @see {@link Discovery} for semantics of each variant
	 */
	discovery?: Discovery;

	/**
	 * Dist directory name relative to `projectRoot`, used for exports-based discovery.
	 *
	 * Maps dist paths from package.json exports back to source paths.
	 *
	 * @default 'dist'
	 */
	distDir?: string;

	/** Optional logger for status messages. */
	log?: AnalysisLog;
}

/** Result of `discoverSourceFiles`. */
export interface DiscoverSourceFilesResult {
	/** Discovered source files with content already loaded. */
	files: Array<SourceFileInfo>;
	/** Diagnostics collected during discovery (e.g., malformed package.json exports). */
	diagnostics: Array<Diagnostic>;
}

/**
 * Discover source files from a project root.
 *
 * Used internally by `analyzeFromFiles` for the discovery step. Standalone
 * consumers can call it directly when they want the discovered file list
 * without running full analysis.
 *
 * Strategy is selected by `discovery`:
 * - `'auto'` (default) — try `exports` first, fall back to glob.
 * - `'exports'` — `exports` only; **throws** if `exports` is missing or
 *   resolves to no source files. Combining with `include` is a configuration
 *   error and also throws.
 * - `'glob'` — glob only; `include` parameterizes the search.
 *
 * Exclusion globs come from `sourceOptions.exclude` (the single source of
 * truth, also applied at analysis time by `isSource()`).
 *
 * @param options - discovery configuration
 * @returns discovered files (content loaded) and any diagnostics from the exports step
 * @throws Error in strict `'exports'` mode when `exports` is missing or
 *   resolves to no source files, or when `include` is combined with
 *   `discovery: 'exports'`.
 *
 * @example
 * ```ts
 * const sourceOptions = createSourceOptions(process.cwd());
 * const {files, diagnostics} = await discoverSourceFiles({sourceOptions});
 * ```
 */
export const discoverSourceFiles = async (
	options: DiscoverSourceFilesOptions,
): Promise<DiscoverSourceFilesResult> => {
	const {sourceOptions, include, discovery = 'auto', distDir, log} = options;
	const {projectRoot, exclude} = sourceOptions;

	// Reject contradictory configurations early. `include` parameterizes glob,
	// so combining it with strict `'exports'` is a user error rather than a
	// silent override.
	if (discovery === 'exports' && include) {
		throw new Error(
			"discovery: 'exports' is incompatible with `include` — `include` is a glob filter. " +
				"Use discovery: 'glob' (with include) or remove include for strict exports mode.",
		);
	}

	// `include` collapses 'auto' to glob immediately — exports-discovery has
	// no concept of include patterns, so honoring `include` under 'auto' would
	// silently drop the user's filter on packages that have an `exports` field.
	const effectiveStrategy: Discovery = discovery === 'auto' && include ? 'glob' : discovery;

	let files: Array<SourceFileInfo> | null = null;
	let diagnostics: Array<Diagnostic> = [];

	if (effectiveStrategy === 'exports' || effectiveStrategy === 'auto') {
		const sourceDir = getSourceRoot(sourceOptions);

		// Exports discovery is single-`sourceDir`-only: it maps every dist path
		// through one source-dir prefix. When `sourcePaths.length > 1` and the
		// auto-derived (or explicit) `sourceRoot` is `''`, every dist entry
		// would resolve to project-root-relative paths instead of the user's
		// actual subdirs — exports discovery cannot represent the layout.
		// Short-circuit instead of letting it silently produce zero files
		// (under 'auto' that falls through harmlessly to glob, but under
		// 'exports' it would throw the misleading generic "resolved to no
		// source files" error).
		if (sourceOptions.sourcePaths.length > 1 && sourceDir === '') {
			if (effectiveStrategy === 'exports') {
				throw new Error(
					"discovery: 'exports' failed — source paths share no common prefix " +
						`(sourcePaths=${JSON.stringify(sourceOptions.sourcePaths)}, sourceRoot=''), ` +
						'so exports discovery cannot map dist paths to source files. ' +
						"Use discovery: 'auto' (default) or 'glob' for this layout, or " +
						'restructure to a single source root.',
				);
			}
			log?.info(
				'Source paths share no common prefix — exports discovery cannot represent this layout; falling back to glob patterns',
			);
		} else {
			const exportsResult = await discoverFromExports({
				projectRoot,
				exclude,
				sourceDir,
				distDir,
			});
			const {files: exportsFiles, diagnostics: exportsDiagnostics} = exportsResult;
			diagnostics = exportsDiagnostics;

			if (exportsFiles && exportsFiles.length > 0) {
				files = exportsFiles;
				log?.info(`Discovered ${files.length} source files from package.json exports`);
			} else if (effectiveStrategy === 'exports') {
				// Strict mode: no fallback. Throw with a message that names the
				// failure mode so users can fix the package.json or relax the strictness.
				const reason =
					exportsFiles === null
						? 'no `exports` field found in package.json'
						: '`exports` field present but resolved to no source files';
				throw new Error(
					`discovery: 'exports' failed — ${reason}. ` +
						`Use discovery: 'auto' (default) to fall back to glob, or fix the package.json exports mapping.`,
				);
			} else if (exportsFiles === null) {
				log?.info('No package.json exports found, falling back to glob patterns');
			} else {
				log?.warn(
					'Package.json exports found but resolved no source files — falling back to glob patterns',
				);
			}
		}
	}

	// Fall back to glob-based discovery (auto fallback or explicit glob mode).
	// Derive include from `sourceOptions.sourcePaths` when none is supplied so
	// custom `sourcePaths` (e.g. `['packages/foo']`) discover files instead of
	// silently defaulting to `src/lib`. Mirrors the CLI's prior local
	// derivation — single source of truth lives here now.
	if (!files) {
		files = await globFiles({
			projectRoot,
			include: include ?? deriveIncludePatterns(sourceOptions.sourcePaths),
			exclude,
		});
		log?.info(`Discovered ${files.length} source files via glob`);
	}

	return {files, diagnostics};
};
