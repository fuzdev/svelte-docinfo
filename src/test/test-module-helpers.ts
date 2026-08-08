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
	type SourceOptionsDefaults
} from '$lib/source-config.ts';
import { applyVirtualFiles, type VirtualFileEntry } from '$lib/typescript-program.ts';
import { analyze } from '$lib/analyze.ts';
import type { AnalyzeResultJson } from '$lib/analyze-core.ts';

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
	overrides?: Partial<SourceOptionsDefaults>
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
export const testSourceOptions = (
	overrides?: Partial<SourceOptionsDefaults>
): ModuleSourceOptions => createTestSourceOptions(process.cwd(), overrides);

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
export const testMockOptions = (overrides?: Partial<SourceOptionsDefaults>): ModuleSourceOptions =>
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

// Cached program for incremental compilation

let _cachedParsedConfig: { options: ts.CompilerOptions; fileNames: Array<string> } | undefined;
let _lastProgram: ts.Program | undefined;

/**
 * Create a TypeScript program with virtual files, using incremental compilation.
 *
 * First call reads tsconfig.json and creates a full program (~1.4s).
 * Subsequent calls reuse parsed source files via `oldProgram` (~100-200ms).
 *
 * Use this in test files that create many programs with the CWD project root
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

	let host: ts.CompilerHost | undefined;
	if (virtualFiles?.size) {
		host = ts.createCompilerHost(options);
		applyVirtualFiles(host, virtualFiles);
	}

	const program = ts.createProgram(rootNames, options, host, _lastProgram);
	_lastProgram = program;
	return program;
};
