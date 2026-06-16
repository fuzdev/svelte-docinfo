/**
 * File system helpers — file loading and glob discovery.
 *
 * Composable primitives for `analyzeFromFiles` / `discoverSourceFiles`. For
 * most use cases prefer those higher-level entry points.
 *
 * Build tools that want to drive resolve outside the session can construct an
 * `ImportResolver` directly and pass it to `createAnalysisSession`.
 *
 * @see `analyzeFromFiles` for the high-level disk-discovery wrapper
 * @see `discoverSourceFiles` for exports-first discovery with glob fallback
 *
 * @module
 */

import {readFile} from 'node:fs/promises';
import {resolve, isAbsolute} from 'node:path';
import {glob} from 'tinyglobby';

import type {SourceFileInfo} from './source.ts';
import {toPosixPath} from './paths.ts';
import {MAX_FILE_CONCURRENCY, map_concurrent} from './concurrency.ts';

/**
 * Load a single source file from disk.
 *
 * Accepts either relative or absolute paths. Relative paths are resolved against `projectRoot`.
 *
 * @param path - file path (relative to `projectRoot` or absolute)
 * @param projectRoot - absolute path to project root
 * @returns source file info with content loaded
 * @throws Error if the file cannot be read (e.g., missing or permission denied)
 *
 * @example
 * ```ts
 * const file = await loadFile('src/lib/math.ts', process.cwd());
 * // {id: '/abs/path/to/src/lib/math.ts', content: '...'}
 * ```
 */
export const loadFile = async (path: string, projectRoot: string): Promise<SourceFileInfo> => {
	const absolutePath = isAbsolute(path) ? path : resolve(projectRoot, path);
	const content = await readFile(absolutePath, 'utf-8');

	return {
		id: toPosixPath(absolutePath),
		content,
	};
};

/**
 * Glob extension list for source files. Matches the extension set covered by
 * `getDefaultAnalyzer` in `source.ts` — keep in sync if a new analyzable
 * extension is added there.
 */
const SOURCE_FILE_EXTENSIONS = 'ts,js,svelte,css,json';

/**
 * Build an include pattern array from source paths.
 *
 * Each path becomes a `<path>/**\/*.{ts,js,svelte,css,json}` glob. Used by
 * `discoverSourceFiles` to derive a default `include` from
 * `sourceOptions.sourcePaths` when no explicit pattern is supplied — keeps
 * the glob fallback consistent with custom `sourcePaths` instead of silently
 * defaulting to `src/lib`.
 *
 * @example
 * ```ts
 * deriveIncludePatterns(['packages/foo', 'packages/bar'])
 * // => ['packages/foo/**\/*.{ts,js,svelte,css,json}', 'packages/bar/**\/*.{ts,js,svelte,css,json}']
 * ```
 */
export const deriveIncludePatterns = (sourcePaths: ReadonlyArray<string>): Array<string> =>
	sourcePaths.map((p) => `${p}/**/*.{${SOURCE_FILE_EXTENSIONS}}`);

/**
 * Options for `globFiles`.
 */
export interface GlobFilesOptions {
	/** Absolute path to project root. */
	projectRoot: string;
	/** Glob patterns to include (relative to `projectRoot`). */
	include: Array<string>;
	/** Optional glob patterns to exclude. */
	exclude?: Array<string>;
}

/**
 * Discover source files via glob patterns.
 *
 * @param options - glob configuration
 * @returns array of source files with content loaded
 * @throws Error if any matched file cannot be read — `Promise.all` rejects on the first read failure
 *
 * @example
 * ```ts
 * const files = await globFiles({
 *   projectRoot: process.cwd(),
 *   include: deriveIncludePatterns(['src/lib']),
 *   exclude: DEFAULT_SOURCE_OPTIONS.exclude,
 * });
 * ```
 */
export const globFiles = async (options: GlobFilesOptions): Promise<Array<SourceFileInfo>> => {
	const {projectRoot, include, exclude} = options;

	const filePaths = await glob(include, {
		cwd: projectRoot,
		ignore: exclude,
		absolute: true,
	});

	// Bounded concurrency to keep FD pressure under the typical ulimit on
	// large projects. See `concurrency.ts`.
	return map_concurrent(filePaths, MAX_FILE_CONCURRENCY, async (id) => {
		const content = await readFile(id, 'utf-8');
		return {id: toPosixPath(id), content};
	});
};
