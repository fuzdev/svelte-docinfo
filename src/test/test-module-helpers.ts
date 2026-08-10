/**
 * Shared test helpers for module analysis tests.
 *
 * Provides consistent test options, program creation, and pipeline-level
 * `analyze` wrappers for source, analyze, typescript, and svelte tests.
 * Lib-coupled — pulls the analysis pipeline (svelte2tsx included) into every
 * importer; fs/fixture/assertion helpers with no such weight live in
 * `test-helpers.ts`.
 */

import ts from 'typescript';
import { join } from 'node:path';

import {
	createSourceOptions,
	DEFAULT_SOURCE_OPTIONS,
	type ModuleSourceOptions,
	type SourceOptionsDefaults,
	type SourceOptionsOverrides
} from '$lib/source-config.ts';
import { applyVirtualFiles, type VirtualFileEntry } from '$lib/typescript-program.ts';
import { analyze } from '$lib/analyze.ts';
import type { AnalyzeResultJson } from '$lib/analyze-core.ts';
import { transformSvelteSource, type SvelteVirtualFile } from '$lib/svelte.ts';
import type { SourceFileInfo } from '$lib/source.ts';

import { withTestProject } from './test-helpers.ts';

/**
 * Analyze a temporary on-disk project built from `files` (one-shot).
 *
 * The common shape of pipeline-level `analyze` tests: write the files, analyze
 * them, clean up, return the result envelope. Every entry is handed to
 * `analyze` as a source file — the query-time source gate scopes module
 * emission to `src/lib` (default `sourcePaths`) minus `exclude`, so extra
 * files (a root `package.json`, say) feed the checker but don't become
 * modules. See `analyze.source-gate.test.ts`.
 *
 * For tests that need real packages (`svelte`) to resolve, use in-memory
 * `analyze()` over `process.cwd()`-rooted ids with `testSourceOptions()`
 * instead — the tmpdir this creates has no reachable `node_modules`.
 */
export const analyzeTestProject = (files: Record<string, string>): Promise<AnalyzeResultJson> =>
	withTestProject(files, (projectRoot) =>
		analyze({
			sourceFiles: Object.entries(files).map(([path, content]) => ({
				id: join(projectRoot, path),
				content
			})),
			sourceOptions: createSourceOptions(projectRoot)
		})
	);

/** Run `transformSvelteSource` and unwrap the virtual file or throw. */
export const transformOrThrow = (sourceFile: SourceFileInfo): SvelteVirtualFile => {
	const result = transformSvelteSource(sourceFile);
	if (!result.virtual) {
		throw new Error(
			`transform failed: ${sourceFile.id}: ${result.diagnostics[0]?.message ?? 'unknown error'}`
		);
	}
	return result.virtual;
};

/** Default project root for tests. */
export const TEST_PROJECT_ROOT = '/home/user/project';

/**
 * Create ModuleSourceOptions for testing with consistent defaults.
 *
 * @param projectRoot Project root path (defaults to TEST_PROJECT_ROOT)
 * @param overrides Optional overrides for default options
 */
export const createTestSourceOptions = (
	projectRoot: string = TEST_PROJECT_ROOT,
	overrides?: SourceOptionsOverrides
): ModuleSourceOptions => createSourceOptions(projectRoot, overrides);

/**
 * Create ModuleSourceOptions using the current working directory.
 *
 * Convenience wrapper for fixture-based tests that run from the project root.
 * Use this when testing against actual fixture files on disk.
 *
 * @param overrides Optional overrides for default options
 *
 * @example
 * ```ts
 * const options = testSourceOptions();
 * const result = analyze({sourceFiles, sourceOptions: options});
 * ```
 */
export const testSourceOptions = (overrides?: SourceOptionsOverrides): ModuleSourceOptions =>
	createTestSourceOptions(process.cwd(), overrides);

/**
 * Create ModuleSourceOptions using the mock TEST_PROJECT_ROOT.
 *
 * Convenience wrapper for unit tests that use mock paths rather than real files.
 * Use this when testing path manipulation and module analysis logic.
 *
 * @param overrides Optional overrides for default options
 *
 * @example
 * ```ts
 * const options = testMockOptions();
 * const path = extractPath('/home/user/project/src/lib/foo.ts', options);
 * ```
 */
export const testMockOptions = (overrides?: SourceOptionsOverrides): ModuleSourceOptions =>
	createTestSourceOptions(TEST_PROJECT_ROOT, overrides);

/**
 * Create ModuleSourceOptions for virtual file tests (no path resolution).
 *
 * Unlike `createTestSourceOptions`, this does not call `resolve()` on the project root,
 * so it works with virtual file paths that don't exist on disk (e.g., `/src/lib/foo.ts`
 * from `createMultiFileProgram`).
 *
 * @param projectRoot Literal project root (default: `''` for virtual files rooted at `/src/lib/`)
 * @param overrides Optional overrides for default options
 */
export const createVirtualSourceOptions = (
	projectRoot: string = '',
	overrides?: Partial<SourceOptionsDefaults>
): ModuleSourceOptions => ({
	projectRoot,
	...DEFAULT_SOURCE_OPTIONS,
	...overrides
});

/**
 * Create a minimal TypeScript program from source code for testing.
 *
 * Useful for testing analysis functions without reading from disk.
 * Mirrors `createAnalysisProgram` by returning `ts.Program` directly.
 *
 * @param files Array of virtual files with path and content
 */
export const createTestProgram = (files: Array<{ path: string; content: string }>): ts.Program => {
	const fileMap = new Map(files.map((f) => [f.path, { content: f.content }]));

	const compilerOptions: ts.CompilerOptions = {
		target: ts.ScriptTarget.Latest,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		strict: true,
		skipLibCheck: true,
		noEmit: true,
		allowJs: true
	};

	const host = ts.createCompilerHost(compilerOptions);
	applyVirtualFiles(host, fileMap);

	return ts.createProgram([...fileMap.keys()], compilerOptions, host);
};

// Cached tsconfig parse + parsed ASTs for `createCachedAnalysisProgram`

let _cachedParsedConfig: { options: ts.CompilerOptions; fileNames: Array<string> } | undefined;
/**
 * Parsed-AST cache keyed by file name. Safe because every program shares the
 * single `_cachedParsedConfig.options` object and repo files don't change
 * mid-run — the same reuse a language service gets from its document
 * registry. Virtuals are served by `applyVirtualFiles` layered above the
 * caching wrapper, so they never enter the cache.
 */
const _sourceFileCache = new Map<string, ts.SourceFile>();

/**
 * Create a TypeScript program over the CWD tsconfig plus optional virtual
 * files, reusing parsed ASTs across calls.
 *
 * The first call reads tsconfig.json and parses the whole program (~1s);
 * subsequent calls re-check but skip re-reading and re-parsing every
 * non-virtual file (`ts.createProgram`'s own `oldProgram` reuse can't apply
 * here — each call has a fresh host and a different root set). Use this in
 * test files that create many programs with the CWD project root
 * (e.g., svelte.test.ts) to avoid paying the full cost per test.
 *
 * @param virtualFiles Optional map of virtual file paths to entries
 */
export const createCachedAnalysisProgram = (
	virtualFiles?: Map<string, VirtualFileEntry>
): ts.Program => {
	if (!_cachedParsedConfig) {
		const projectRoot = process.cwd();
		const configPath = ts.findConfigFile(projectRoot, ts.sys.fileExists, 'tsconfig.json');
		if (!configPath) throw new Error('No tsconfig.json found');
		const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
		_cachedParsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, projectRoot);
	}

	const { options, fileNames } = _cachedParsedConfig;
	const rootNames = virtualFiles?.size ? [...fileNames, ...virtualFiles.keys()] : fileNames;

	const host = ts.createCompilerHost(options);
	const uncachedGetSourceFile = host.getSourceFile.bind(host);
	host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
		const cached = _sourceFileCache.get(fileName);
		if (cached) return cached;
		const sourceFile = uncachedGetSourceFile(
			fileName,
			languageVersion,
			onError,
			shouldCreateNewSourceFile
		);
		if (sourceFile) _sourceFileCache.set(fileName, sourceFile);
		return sourceFile;
	};
	if (virtualFiles?.size) {
		applyVirtualFiles(host, virtualFiles);
	}

	return ts.createProgram(rootNames, options, host);
};
