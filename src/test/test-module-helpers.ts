/**
 * Shared test helpers for module analysis tests.
 *
 * Provides consistent test options and program creation for
 * source, analyze, typescript, and svelte tests.
 */

import ts from 'typescript';

import {
	createSourceOptions,
	DEFAULT_SOURCE_OPTIONS,
	type ModuleSourceOptions,
	type SourceOptionsDefaults
} from '$lib/source-config.ts';

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
	const fileMap = new Map(files.map((f) => [f.path, f.content]));

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
	const originalRead = host.readFile.bind(host);
	host.readFile = (filename) => fileMap.get(filename) ?? originalRead(filename);
	host.fileExists = (filename) => fileMap.has(filename) || ts.sys.fileExists(filename);

	return ts.createProgram(Array.from(fileMap.keys()), compilerOptions, host);
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
 * @param virtualFiles Optional map of virtual file paths to content
 */
export const createCachedAnalysisProgram = (virtualFiles?: Map<string, string>): ts.Program => {
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
		const originalGetSourceFile = host.getSourceFile;
		const originalFileExists = host.fileExists;
		const originalReadFile = host.readFile;

		host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
			const content = virtualFiles.get(fileName);
			if (content !== undefined) {
				return ts.createSourceFile(fileName, content, languageVersion, true);
			}
			return originalGetSourceFile.call(host, fileName, languageVersion, onError, shouldCreate);
		};
		host.fileExists = (fileName) =>
			virtualFiles.has(fileName) || originalFileExists.call(host, fileName);
		host.readFile = (fileName) =>
			virtualFiles.get(fileName) ?? originalReadFile.call(host, fileName);
	}

	const program = ts.createProgram(rootNames, options, host, _lastProgram);
	_lastProgram = program;
	return program;
};
