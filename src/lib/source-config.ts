/**
 * Source configuration, path extraction, and file filtering.
 *
 * Provides `ModuleSourceOptions` configuration management and functions
 * that operate on source files using those options: path extraction,
 * source detection, dependency filtering, and file collection.
 *
 * @see `source.ts` for pure file type predicates (`isTypescript`, `isSvelte`, etc.)
 * @see `analyze.ts` for consumers (`analyze`, `analyzeFromFiles`)
 *
 * @module
 */

import { resolve, relative } from 'node:path';
import picomatch from 'picomatch';

import { type AnalyzerType, type SourceFileInfo, getDefaultAnalyzer } from './source.ts';
import { toPosixPath } from './paths.ts';
import { compareStrings } from './postprocess.ts';
import type { AnalysisLog } from './log.ts';

/**
 * Configuration for module source detection and path extraction.
 *
 * Uses proper path semantics with `projectRoot` as the base for all path operations.
 * Paths are matched using `startsWith` rather than substring search, which correctly
 * handles nested directories without special heuristics.
 *
 * @example
 * ```ts
 * const options = createSourceOptions(process.cwd(), {
 *   sourcePaths: ['src/lib', 'src/routes'],
 *   sourceRoot: 'src',
 * });
 * ```
 */
export interface ModuleSourceOptions {
	/**
	 * Path to the project root directory.
	 *
	 * All `sourcePaths` are relative to this. Typically `process.cwd()`.
	 * Normalized (resolved to absolute, posixified to forward slashes,
	 * trailing slash stripped) by `normalizeSourceOptions`, which returns a
	 * new options object. Internal callers (`isSource`, `extractPath`) assume
	 * this is already POSIX form — construct via `createSourceOptions` /
	 * `normalizeSourceOptions` rather than building `ModuleSourceOptions`
	 * literals by hand on Windows.
	 *
	 * @example
	 * ```ts
	 * '/home/user/my-project'
	 * ```
	 */
	projectRoot: string;
	/**
	 * Source directory paths to include, relative to `projectRoot`.
	 *
	 * Absolute entries are accepted when they resolve inside `projectRoot` and
	 * are stored root-relative; an entry resolving outside it throws (a
	 * root-anchored `'/src/lib'` is taken as filesystem-absolute, not
	 * shorthand — the error hints to drop the slash). Normalized (`.`/`..`
	 * segments collapsed, trailing slashes stripped) by
	 * `normalizeSourceOptions`, which returns a new options object.
	 *
	 * @example
	 * ```ts
	 * ['src/lib'] // single source directory
	 * ```
	 * @example
	 * ```ts
	 * ['src/lib', 'src/routes'] // multiple directories
	 * ```
	 */
	sourcePaths: Array<string>;
	/**
	 * Source root for extracting relative module paths, relative to `projectRoot`.
	 *
	 * Normalized like `sourcePaths` entries (absolute-inside-root accepted and
	 * stored root-relative, `.`/`..` collapsed — so `'.'` becomes `''`,
	 * trailing slashes stripped, out-of-root throws) by
	 * `normalizeSourceOptions`, which returns a new options object.
	 *
	 * When omitted:
	 * - Single `sourcePath`: defaults to that path
	 * - Multiple `sourcePaths`: auto-derived as the longest common directory prefix
	 *   (or `''` when paths share no common prefix — produces project-relative module paths)
	 *
	 * @example
	 * ```ts
	 * 'src/lib' // module paths like 'foo.ts', 'utils/bar.ts'
	 * ```
	 * @example
	 * ```ts
	 * 'src' // module paths like 'lib/foo.ts', 'routes/page.svelte'
	 * ```
	 * @example
	 * ```ts
	 * '' // or '.': module paths stay project-relative, e.g. 'src/lib/foo.ts'
	 * ```
	 */
	sourceRoot?: string;
	/**
	 * Glob patterns to exclude from analysis, relative to `projectRoot`.
	 *
	 * Applied at both stages of the pipeline:
	 * - **Discovery time** by `globFiles`/`discoverFromExports`, preventing matched files from being loaded.
	 * - **Analysis time** by `isSource()` against `relative(projectRoot, absolutePath)`,
	 *   catching files that enter through TypeScript import resolution
	 *   (e.g., a source file imports a test helper).
	 *
	 * `analyzeFromFiles` accepts a top-level `exclude` shortcut that merges into this field.
	 *
	 * Compiled to a matcher once per options object via picomatch and cached by reference;
	 * mutating this array post-`isSource`-call has no effect — pass through
	 * `normalizeSourceOptions` (which returns a fresh object) or otherwise build a
	 * new options object to apply changes.
	 *
	 * @default `['**\/*.test.ts', '**\/*.spec.ts']`
	 */
	exclude: Array<string>;
	/**
	 * Determine which analyzer to use for a file path.
	 *
	 * Called for files in source directories. Return an `AnalyzerType` or `null` to skip:
	 * - `'typescript'` — TypeScript/JS files analyzed via TypeScript compiler API
	 * - `'svelte'` — Svelte components analyzed via svelte2tsx + TypeScript compiler API
	 * - `'css'` — CSS files included as modules with no declarations
	 * - `'json'` — JSON files included as modules with no declarations
	 * - `null` — skip the file
	 *
	 * @default Uses file extension: `.svelte` → svelte, `.ts`/`.js` → typescript, `.css` → css, `.json` → json
	 *
	 * @example
	 * ```ts
	 * // Add MDsveX support
	 * getAnalyzerType: (path) => {
	 *   if (path.endsWith('.svelte') || path.endsWith('.svx')) return 'svelte';
	 *   if (path.endsWith('.ts') || path.endsWith('.js')) return 'typescript';
	 *   if (path.endsWith('.css')) return 'css';
	 *   if (path.endsWith('.json')) return 'json';
	 *   return null;
	 * }
	 * ```
	 *
	 * @example
	 * ```ts
	 * // Include .d.ts files
	 * getAnalyzerType: (path) => {
	 *   if (path.endsWith('.svelte')) return 'svelte';
	 *   if (path.endsWith('.ts') || path.endsWith('.d.ts') || path.endsWith('.js')) return 'typescript';
	 *   if (path.endsWith('.css')) return 'css';
	 *   if (path.endsWith('.json')) return 'json';
	 *   return null;
	 * }
	 * ```
	 */
	getAnalyzerType: (path: string) => AnalyzerType | null;
}

/**
 * Default source options preset (without `projectRoot`).
 *
 * Use with `createSourceOptions` to build complete options.
 * Contains all `ModuleSourceOptions` fields except `projectRoot`,
 * which is provided separately as the first argument to `createSourceOptions`.
 */
export type SourceOptionsDefaults = Omit<ModuleSourceOptions, 'projectRoot'>;

/**
 * Default partial options for standard SvelteKit library structure.
 *
 * Does not include `projectRoot` — use `createSourceOptions` to create
 * complete options with your project root.
 *
 * `exclude` is the single source of truth for filtering: globs applied at both
 * discovery time (by `globFiles`/`discoverFromExports`) and analysis time
 * (by `isSource()` against project-root-relative paths).
 *
 * @see `createSourceOptions` for the typical way to build complete options
 */
export const DEFAULT_SOURCE_OPTIONS: SourceOptionsDefaults = {
	sourcePaths: ['src/lib'],
	exclude: ['**/*.test.ts', '**/*.spec.ts'],
	getAnalyzerType: getDefaultAnalyzer
};

/**
 * Create complete, normalized, validated source options from project root and optional overrides.
 *
 * Merges `overrides` with `DEFAULT_SOURCE_OPTIONS`, then normalizes via
 * `normalizeSourceOptions` — so the returned object always has an absolute
 * `projectRoot`, slash-stripped path entries, and an explicit `sourceRoot`
 * (auto-derived for multi-path layouts). Throws on validation failure.
 *
 * @param projectRoot - path to project root (typically `process.cwd()`); resolved to absolute
 * @param overrides - optional overrides for default options
 * @throws Error if validation fails (empty `sourcePaths`, or `sourceRoot` not a prefix of all `sourcePaths`)
 *
 * @example
 * ```ts
 * // Standard SvelteKit library
 * const options = createSourceOptions(process.cwd());
 * ```
 *
 * @example
 * ```ts
 * // Multiple source directories
 * const options = createSourceOptions(process.cwd(), {
 *   sourcePaths: ['src/lib', 'src/routes'],
 *   sourceRoot: 'src',
 * });
 * ```
 *
 * @example
 * ```ts
 * // Custom exclusions
 * const options = createSourceOptions(process.cwd(), {
 *   exclude: ['**\/*.test.ts', '**\/*.internal.ts'],
 * });
 * ```
 */
export const createSourceOptions = (
	projectRoot: string,
	overrides?: Partial<SourceOptionsDefaults>
): ModuleSourceOptions =>
	normalizeSourceOptions({
		projectRoot,
		...DEFAULT_SOURCE_OPTIONS,
		...overrides
	});

/**
 * Normalize and validate `ModuleSourceOptions`, returning a new options object.
 *
 * Normalization:
 * - `projectRoot` resolved to absolute via `path.resolve` (relative paths resolve against cwd)
 * - Trailing slash stripped from `projectRoot`
 * - `sourcePaths` entries and `sourceRoot` resolved against `projectRoot` and
 *   stored root-relative: `.`/`..` segments collapse (`src/../lib` → `lib`,
 *   `.` → `''`), trailing slashes drop, and absolute entries inside the root
 *   relativize (matching `loadFile`'s treatment of path inputs)
 *
 * Validation (after normalization):
 * 1. No `sourcePaths` entry or `sourceRoot` resolves outside `projectRoot`
 *    (out-of-root modules are unrepresentable — module paths and diagnostics
 *    are project-root-relative; widened include bases funnel through here
 *    too; absolute out-of-root entries get a drop-the-leading-slash hint)
 * 2. `sourcePaths` has at least one entry
 * 3. `sourceRoot` (if provided and non-empty) is a prefix of all `sourcePaths`
 *
 * When `sourceRoot` is omitted and multiple `sourcePaths` are provided,
 * `sourceRoot` is auto-derived as their longest common path prefix. If the
 * paths share no common prefix, the derived root is `''` and `extractPath`
 * produces project-relative module paths.
 *
 * Returns a fresh object — the input is not mutated. Re-normalization produces
 * a fresh identity, which naturally invalidates the `excludeMatcherCache`
 * (keyed by options-object identity) without a separate "rebuild a fresh
 * object" rule.
 *
 * @returns a new `ModuleSourceOptions` with normalized fields
 * @throws Error if validation fails
 *
 * @example
 * ```ts
 * // Normalization: trailing slash and dot segments collapse, relative projectRoot resolves
 * const normalized = normalizeSourceOptions({projectRoot: '.', sourcePaths: ['src/../src/lib/'], ...});
 * // normalized.projectRoot is now absolute, normalized.sourcePaths is ['src/lib']
 * ```
 */
export const normalizeSourceOptions = (options: ModuleSourceOptions): ModuleSourceOptions => {
	// Normalize projectRoot: resolve to absolute, posixify, strip trailing slash.
	// Posixify after `resolve` because `path.resolve` returns native separators
	// on Windows; everything internal compares against forward-slash form.
	let projectRoot = toPosixPath(resolve(options.projectRoot));
	if (projectRoot.length > 1 && projectRoot.endsWith('/')) {
		projectRoot = projectRoot.slice(0, -1);
	}

	// Normalize sourcePaths through resolve+relative: posixify (in case a
	// Windows user supplies `'src\\lib'`), collapse `.`/`..` segments so the
	// textual prefix checks in `isSource`/`extractPath` see canonical entries
	// (`src/../lib` → `lib`, `.` → `''`), and accept absolute entries that
	// resolve inside the project root by storing them root-relative (matching
	// `loadFile`'s treatment of path inputs). An entry that resolves outside
	// the project root throws: out-of-root modules are unrepresentable
	// (`ModuleJson.path` and `Diagnostic.file` are project-root-relative by
	// contract), so the config would be silently dead — discovery finds the
	// files, ingest accepts them, the query-time source gate drops every one
	// with no trace beyond its info log. Include-pattern widening re-runs
	// `createSourceOptions`, so an out-of-root include base fails here too.
	const sourcePaths = options.sourcePaths.map((p) =>
		toRootRelativePath(
			p,
			projectRoot,
			'sourcePaths entry',
			'Out-of-root files cannot be analyzed — module paths and diagnostics are ' +
				'project-root-relative. Point projectRoot at a common ancestor of all source ' +
				'directories instead. (Explicit include patterns contribute their base ' +
				'directories to sourcePaths, so an out-of-root include fails here too.)'
		)
	);

	// Validate sourcePaths non-empty
	if (sourcePaths.length === 0) {
		throw new Error(
			'ModuleSourceOptions.sourcePaths must have at least one entry. ' +
				"For SvelteKit projects, the default is ['src/lib']; for plain TS, try ['src']."
		);
	}

	// Normalize sourceRoot the same way. `.` (the ergonomic CLI form) and `''`
	// (the shell-quoting form) both resolve to the project-root sentinel `''`,
	// which `extractPath` interprets as "strip projectRoot only" (module paths
	// stay project-relative).
	let sourceRoot =
		options.sourceRoot === undefined
			? undefined
			: toRootRelativePath(
					options.sourceRoot,
					projectRoot,
					'sourceRoot',
					'Module paths are extracted relative to projectRoot/sourceRoot, so sourceRoot ' +
						'must stay inside the project root.'
				);

	// Auto-derive sourceRoot for multiple sourcePaths when not explicitly provided.
	// Empty common prefix is a valid result — `extractPath` will produce
	// project-relative module paths (e.g., `lib/foo.ts`, `routes/page.svelte`)
	// instead of stripping a common directory prefix.
	if (sourceRoot === undefined && sourcePaths.length > 1) {
		sourceRoot = deriveCommonPrefix(sourcePaths);
	}

	// Validate sourceRoot prefix constraint (if sourceRoot is set — either explicit or auto-derived)
	if (sourceRoot !== undefined && sourceRoot !== '') {
		for (const sourcePath of sourcePaths) {
			if (sourcePath !== sourceRoot && !sourcePath.startsWith(sourceRoot + '/')) {
				throw new Error(
					`sourcePaths entry "${sourcePath}" must start with sourceRoot "${sourceRoot}". ` +
						`extractPath uses sourceRoot to compute module paths.`
				);
			}
		}
	}

	return { ...options, projectRoot, sourcePaths, sourceRoot };
};

/** Strip all leading and trailing forward slashes from a path segment. */
const stripSlashes = (p: string): string => {
	let result = p;
	while (result.startsWith('/')) result = result.slice(1);
	while (result.endsWith('/')) result = result.slice(0, -1);
	return result;
};

/**
 * Normalize a projectRoot-relative path option to canonical root-relative form.
 *
 * Accepts relative entries (anchored at `projectRoot`) and absolute entries
 * that resolve inside it — matching `loadFile`'s treatment of path inputs —
 * and collapses `.`/`..` segments so downstream textual prefix checks see
 * canonical paths. Throws when the entry resolves outside `projectRoot`, with
 * a drop-the-leading-slash hint for absolute entries (`'/src/lib'` is taken
 * as a filesystem-absolute path, not root-anchored shorthand).
 */
const toRootRelativePath = (
	value: string,
	projectRoot: string,
	label: string,
	detail: string
): string => {
	const posix = toPosixPath(value);
	const rel = toPosixPath(relative(projectRoot, resolve(projectRoot, posix)));
	if (rel === '..' || rel.startsWith('../')) {
		const absoluteHint = posix.startsWith('/')
			? ' Absolute paths are accepted when they resolve inside projectRoot; for a ' +
				`project-root-relative path drop the leading slash ("${stripSlashes(posix)}").`
			: '';
		throw new Error(
			`${label} "${posix}" escapes projectRoot "${projectRoot}". ${detail}${absoluteHint}`
		);
	}
	return rel;
};

/**
 * Static base directory of a discovery include pattern.
 *
 * `picomatch.scan().base` for glob patterns (`'src/other/**\/*.ts'` →
 * `'src/other'`); a literal non-glob pattern names a file, so it contributes
 * its directory (`'src/foo.ts'` → `'src'`, a root file → `''`); a negated
 * pattern has no base (`null`). Shared by `widenSourcePathsForInclude`
 * (scope widening), `globFiles` (anchoring the baseline exclusions), and
 * `createSourceOptionsWithInclude` (detecting root-scoping patterns to log).
 */
export const includePatternBase = (pattern: string): string | null => {
	const scanned = picomatch.scan(pattern);
	if (scanned.negated) return null;
	// TODO: an absolute include pattern (tinyglobby treats it as absolute) gets
	// its base mangled by this leading-slash strip — decide whether to
	// relativize in-root ones like `normalizeSourceOptions` does for
	// sourcePaths, which also needs a story for the anchored glob ignores
	let base = stripSlashes(toPosixPath(scanned.base));
	if (!scanned.isGlob) {
		base = base.includes('/') ? base.slice(0, base.lastIndexOf('/')) : '';
	}
	return base;
};

/**
 * Union `sourcePaths` with the static base directories of explicit include
 * patterns, so include-discovered files count as source at analysis time.
 *
 * Discovery `include` globs can reach outside `sourcePaths` (`--include
 * 'src/other/**'` under the default `['src/lib']`); without widening, the
 * query-time source gate would drop those modules, and `extractPath` would
 * have no root to relativize their paths against (its fallback is the
 * absolute path). Each pattern contributes its static base (see
 * `includePatternBase`). A root-crossing pattern (`'**\/*.ts'`) contributes
 * `''`, which scopes the whole project root as source.
 *
 * Pure path-set logic — callers re-run `createSourceOptions` on the widened
 * list so sourceRoot derivation and validation see the final set (an
 * *explicit* sourceRoot that doesn't prefix a widened path fails that
 * validation loudly rather than emitting absolute module paths; an
 * out-of-root base hits the projectRoot-escape throw). Returns the input
 * array identity when nothing widens. `createSourceOptionsWithInclude` wraps
 * both steps for the common call shape.
 */
export const widenSourcePathsForInclude = (
	sourcePaths: ReadonlyArray<string>,
	include: ReadonlyArray<string>
): ReadonlyArray<string> => {
	const seen = new Set(sourcePaths);
	const widened = [...sourcePaths];
	for (const pattern of include) {
		const base = includePatternBase(pattern);
		if (base === null || seen.has(base)) continue;
		seen.add(base);
		widened.push(base);
	}
	return widened.length === sourcePaths.length ? sourcePaths : widened;
};

/**
 * Create source options with include-pattern widening applied.
 *
 * The include-aware form of `createSourceOptions`, used by the discovery
 * entry points (`analyzeFromFiles`, the Vite plugin): builds options from
 * `overrides`, then unions each include pattern's static base into
 * `sourcePaths` via `widenSourcePathsForInclude` so include-discovered files
 * pass the query-time source gate. When the set widens, options are rebuilt
 * from the original `overrides` so sourceRoot derivation and validation
 * (including the projectRoot-escape throw) see the final set — re-normalizing
 * the first result would bake a derived `sourceRoot` in as if explicit and
 * fail validation against the widened bases. Owning both steps here keeps
 * that original-overrides requirement an implementation detail instead of a
 * caller contract.
 *
 * Logs when a pattern contributes the `''` base: a root-crossing glob
 * (`'**\/*.ts'`) or a literal root file (`'vite.config.ts'`) scopes the whole
 * project root as source — the baseline exclusions (node_modules,
 * dot-directories) shrink that cliff but don't remove it, so the widening
 * leaves a trace instead of happening silently.
 *
 * @param projectRoot - path to project root (typically `process.cwd()`); resolved to absolute
 * @param overrides - optional overrides for default options
 * @param include - explicit include patterns (absent or empty means plain `createSourceOptions`)
 * @param log - receives the root-scoping info line
 * @throws Error if validation fails, including a widened base escaping the project root
 */
export const createSourceOptionsWithInclude = (
	projectRoot: string,
	overrides: Partial<SourceOptionsDefaults> | undefined,
	include: ReadonlyArray<string> | undefined,
	log?: AnalysisLog
): ModuleSourceOptions => {
	const options = createSourceOptions(projectRoot, overrides);
	if (!include?.length) return options;
	const widened = widenSourcePathsForInclude(options.sourcePaths, include);
	if (widened === options.sourcePaths) return options;
	if (widened.includes('') && !options.sourcePaths.includes('')) {
		const rootPatterns = include.filter((p) => includePatternBase(p) === '');
		log?.info(
			`Include ${rootPatterns.length === 1 ? 'pattern' : 'patterns'} ` +
				`${rootPatterns.map((p) => `"${p}"`).join(', ')} ` +
				`${rootPatterns.length === 1 ? 'has' : 'have'} no base directory — scoping the whole ` +
				'project root as source (module paths become project-root-relative; node_modules and ' +
				'dot-directories stay excluded)'
		);
	}
	return createSourceOptions(options.projectRoot, {
		...overrides,
		sourcePaths: [...widened]
	});
};

/**
 * Derive the longest common directory prefix from an array of paths.
 *
 * @returns common prefix (e.g., `['src/lib', 'src/routes']` → `'src'`),
 *   or empty string if paths share no common prefix
 */
const deriveCommonPrefix = (paths: Array<string>): string => {
	if (paths.length === 0) return '';
	const segments = paths[0]!.split('/');
	let common = '';
	for (const segment of segments) {
		const candidate = common ? common + '/' + segment : segment;
		if (paths.every((p) => p === candidate || p.startsWith(candidate + '/'))) {
			common = candidate;
		} else {
			break;
		}
	}
	return common;
};

/**
 * Get the effective `sourceRoot` from options.
 *
 * Returns `sourceRoot` if provided, otherwise:
 * - Single `sourcePath`: returns that path
 * - Multiple `sourcePaths`: derives the longest common directory prefix
 *
 * @returns the effective source root path
 */
export const getSourceRoot = (options: ModuleSourceOptions): string => {
	if (options.sourceRoot !== undefined) {
		return options.sourceRoot;
	}
	if (options.sourcePaths.length === 1) {
		return options.sourcePaths[0]!;
	}
	return deriveCommonPrefix(options.sourcePaths);
};

/**
 * Extract module path relative to source root from absolute source ID.
 *
 * Uses proper path semantics: strips `projectRoot/sourceRoot/` prefix.
 *
 * @param sourceId - absolute path to the source file
 * @param options - module source options for path extraction
 *
 * @example
 * ```ts
 * const options = createSourceOptions('/home/user/project');
 * extractPath('/home/user/project/src/lib/foo.ts', options) // => 'foo.ts'
 * extractPath('/home/user/project/src/lib/nested/bar.svelte', options) // => 'nested/bar.svelte'
 * ```
 *
 * @example
 * ```ts
 * const options = createSourceOptions('/home/user/project', {
 *   sourcePaths: ['src/lib', 'src/routes'],
 *   sourceRoot: 'src',
 * });
 * extractPath('/home/user/project/src/lib/foo.ts', options) // => 'lib/foo.ts'
 * extractPath('/home/user/project/src/routes/page.svelte', options) // => 'routes/page.svelte'
 * ```
 */
export const extractPath = (sourceId: string, options: ModuleSourceOptions): string => {
	// Posixify input so the prefix slice works regardless of which separator
	// the caller's path system uses. `options.projectRoot` is already POSIX.
	const posixId = toPosixPath(sourceId);
	const effectiveRoot = getSourceRoot(options);
	// Build the full prefix: projectRoot + '/' + sourceRoot + '/'
	// When sourceRoot is empty, prefix is just projectRoot + '/'
	const prefix = effectiveRoot
		? options.projectRoot + '/' + effectiveRoot + '/'
		: options.projectRoot + '/';

	if (posixId.startsWith(prefix)) {
		return posixId.slice(prefix.length);
	}
	// Fallback: return full path if prefix doesn't match (shouldn't happen with valid inputs)
	return posixId;
};

/**
 * Whether a base-relative path contains an always-excluded directory segment.
 *
 * The always-on baseline: `node_modules` directories and dot-directories
 * (`.svelte-kit`, `.git`, `.cache`, …) are never source. Matched against the
 * path *relative to the matched source path*, not the project root — so an
 * explicit dot-dir source path (`sourcePaths: ['.hidden/src']`) still works:
 * the dot segment sits in the base, not the remainder. That relativity is the
 * opt-out; there is no flag. Deliberately only these two families —
 * `dist`/`build`/`coverage` are ordinary names a project can legitimately
 * keep source in, and over-excluding fails silently.
 *
 * Only directory segments are checked; the final segment (the file itself)
 * is not, so a dotfile like `.config.ts` inside a source dir passes.
 *
 * Deliberately NOT part of `DEFAULT_SOURCE_OPTIONS.exclude`: user `exclude`
 * replaces the defaults wholesale and would silently strip the baseline.
 * `baselineExcludesForBase` is the discovery-time glob form.
 *
 * @param relPath - POSIX path relative to a matched source path / discovery base
 */
export const hasBaselineExcludedSegment = (relPath: string): boolean => {
	let start = 0;
	for (;;) {
		const slash = relPath.indexOf('/', start);
		if (slash === -1) return false; // final segment is the file, not a directory
		const segment = relPath.slice(start, slash);
		if (segment === 'node_modules' || segment.startsWith('.')) return true;
		start = slash + 1;
	}
};

/** Glob-ignore form of the always-on baseline (see `hasBaselineExcludedSegment`). */
const BASELINE_EXCLUDE_GLOBS: ReadonlyArray<string> = ['**/node_modules/**', '**/.*/**'];

/**
 * Anchor the baseline exclusion globs below a discovery base directory.
 *
 * Anchoring is what preserves the escape hatch at discovery time: the ignores
 * for base `.hidden/src` are `.hidden/src/**\/node_modules/**` etc., which
 * don't match the base's own dot segment. `''` anchors at the project root.
 * Used as glob `ignore` by `globFiles` (per include-pattern base) and
 * `discoverFromExports` (below the source dir).
 */
export const baselineExcludesForBase = (base: string): Array<string> =>
	BASELINE_EXCLUDE_GLOBS.map((g) => (base ? `${base}/${g}` : g));

/**
 * Compiled glob-matcher cache for `options.exclude`, keyed by options object identity.
 *
 * Picomatch compilation is non-trivial; caching avoids re-parsing the same patterns
 * on every `isSource()` call. Mutating `options.exclude` post-cache-population has
 * no effect — callers that need to change the exclude list must build a fresh
 * options object (different identity). `normalizeSourceOptions` returns a new
 * object, so re-running it through normalize naturally produces a fresh identity
 * and the cache populates fresh on first access.
 */
const excludeMatcherCache: WeakMap<ModuleSourceOptions, (relPath: string) => boolean> =
	new WeakMap();

const getExcludeMatcher = (options: ModuleSourceOptions): ((relPath: string) => boolean) => {
	let matcher = excludeMatcherCache.get(options);
	if (!matcher) {
		matcher = options.exclude.length === 0 ? () => false : picomatch(options.exclude);
		excludeMatcherCache.set(options, matcher);
	}
	return matcher;
};

/**
 * Check if a path is an analyzable source file.
 *
 * Combines all filtering: source directory paths, the always-on baseline
 * (`node_modules` + dot-directories below the matched source path — see
 * `hasBaselineExcludedSegment`), exclude globs, and analyzer availability.
 * This is the single check for whether a file should be included in library
 * analysis.
 *
 * Uses proper path semantics with `startsWith` matching against
 * `projectRoot/sourcePath/`. No heuristics needed — nested directories are
 * correctly excluded by the prefix check.
 *
 * Order is sourceDir-then-exclude: the prefix check guarantees the path lives
 * under `projectRoot` before relativization, so `relative()` always produces
 * a clean glob-shaped string for the matcher. Files outside `projectRoot`
 * (rare; would require monorepo path mapping) short-circuit at the prefix
 * check before reaching the matcher.
 *
 * @param path - full absolute path to check
 * @param options - module source options for filtering
 * @returns true if the path is an analyzable source file
 *
 * @example
 * ```ts
 * const options = createSourceOptions('/home/user/project');
 * isSource('/home/user/project/src/lib/foo.ts', options) // => true
 * isSource('/home/user/project/src/lib/styles.css', options) // => true
 * isSource('/home/user/project/src/lib/data.json', options) // => true
 * isSource('/home/user/project/src/lib/foo.test.ts', options) // => false (excluded)
 * isSource('/home/user/project/src/fixtures/mini/src/lib/bar.ts', options) // => false (wrong prefix)
 * ```
 */
export const isSource = (path: string, options: ModuleSourceOptions): boolean => {
	// Posixify input — callers may pass native paths (Windows backslashes).
	// `options.projectRoot` and `sourcePaths` are already POSIX after
	// `normalizeSourceOptions`.
	const posixPath = toPosixPath(path);

	// Source-dir prefix check first — guarantees the path lives under projectRoot
	// before we relativize for glob matching. Out-of-root files (which can't be
	// sources anyway) short-circuit here without reaching the matcher.
	const inSourceDir = options.sourcePaths.some((sourcePath) => {
		// '' scopes to the whole project root (a root-crossing include base —
		// see `widenSourcePathsForInclude`)
		const fullPrefix =
			sourcePath === '' ? options.projectRoot + '/' : options.projectRoot + '/' + sourcePath + '/';
		if (!posixPath.startsWith(fullPrefix)) return false;
		// Always-on baseline, relative to the matched sourcePath: node_modules
		// and dot-directory segments below it are never source. Per-sourcePath
		// so a broader scope (a widened `''`) can't veto a specific opt-in
		// (`.hidden/src`) — see `hasBaselineExcludedSegment`.
		return !hasBaselineExcludedSegment(posixPath.slice(fullPrefix.length));
	});
	if (!inSourceDir) return false;

	// Glob-match the project-root-relative path against `exclude`. `relative`
	// returns native separators on Windows; posixify so the matcher sees the
	// same forward-slash form the user wrote their globs in.
	const relPath = toPosixPath(relative(options.projectRoot, posixPath));
	if (getExcludeMatcher(options)(relPath)) return false;

	// Check if file type is analyzable. Pass the posixified form so analyzer
	// callbacks see the canonical id, not a native-separator variant.
	return options.getAnalyzerType(posixPath) !== null;
};

/**
 * Extract dependencies and dependents for a module from source file info.
 *
 * Filters to only include source modules (excludes external packages, node_modules, tests).
 * Returns sorted arrays of module paths (relative to `sourceRoot`) for deterministic output.
 *
 * Native paths in `sourceFile.dependencies`/`dependents` are accepted —
 * `isSource` and `extractPath` posixify their inputs, so direct callers with
 * hand-built input need not pre-normalize.
 *
 * Accepts `SourceFileInfo` plus an optional `dependents` field — the public
 * input type carries only `dependencies` (caller-supplied opt-in), while
 * `dependents` is computed downstream by `computeDependents` and flows through
 * as an enriched shape.
 *
 * @param sourceFile - the source file info to extract dependencies from
 * @param options - module source options for filtering and path extraction
 * @returns sorted arrays of module paths (relative to `sourceRoot`) for dependencies and dependents
 */
export const extractDependencies = (
	sourceFile: SourceFileInfo & { dependents?: ReadonlyArray<string> },
	options: ModuleSourceOptions
): { dependencies: Array<string>; dependents: Array<string> } => {
	const dependencies: Array<string> = [];
	const dependents: Array<string> = [];

	// Extract dependencies (files this module imports) if provided
	if (sourceFile.dependencies) {
		for (const depId of sourceFile.dependencies) {
			if (isSource(depId, options)) {
				dependencies.push(extractPath(depId, options));
			}
		}
	}

	// Extract dependents (files that import this module) if provided
	if (sourceFile.dependents) {
		for (const dependentId of sourceFile.dependents) {
			if (isSource(dependentId, options)) {
				dependents.push(extractPath(dependentId, options));
			}
		}
	}

	// Sort for deterministic output
	dependencies.sort(compareStrings);
	dependents.sort(compareStrings);

	return { dependencies, dependents };
};
