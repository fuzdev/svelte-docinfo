/**
 * Shared test utilities for vitest tests.
 * Provides helpers for test data normalization,
 * temporary test project creation, and generic fixture loading/updating patterns.
 */

import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import type ts from 'typescript';
import { assert } from 'vitest';

import { compareStrings } from '$lib/postprocess.ts';
import type { AnalysisLog } from '$lib/log.ts';
import type { ExtractContext } from '$lib/typescript-extract-shared.ts';
import type {
	DeclarationJson,
	FunctionDeclarationJson,
	ComponentDeclarationJson,
	ModuleJson
} from '$lib/types.ts';

/**
 * Create an `AnalysisLog` that collects info messages for assertions.
 *
 * Warnings and errors are dropped — tests asserting on those thread their
 * own handlers.
 */
export const collectingLog = (): { infos: Array<string>; log: AnalysisLog } => {
	const infos: Array<string> = [];
	return { infos, log: { info: (msg) => infos.push(msg), warn: () => {}, error: () => {} } };
};

/**
 * A minimal `ExtractContext` for tests driving extraction seams directly
 * (extractors, `analyzeExports`, `analyzeTypescriptModule`): fresh
 * diagnostics array, nothing external, no alias registry (written-name
 * recovery only), widening-mode optionals. Override per test via `overrides`.
 */
export const mockExtractContext = (
	checker: ts.TypeChecker,
	overrides?: Partial<ExtractContext>
): ExtractContext => ({
	checker,
	diagnostics: [],
	isExternalFile: () => false,
	aliasRegistry: undefined,
	exactOptionalPropertyTypes: false,
	...overrides
});

/**
 * Compiler options for `createTestProject`'s default tsconfig. Exported so a
 * test supplying its own tsconfig (e.g. to add a compiler flag) extends these
 * rather than restating them — a restated copy drifts silently when the
 * defaults change.
 */
export const TEST_TSCONFIG_COMPILER_OPTIONS = {
	module: 'ESNext',
	moduleResolution: 'bundler',
	target: 'ESNext',
	strict: true
} as const;

/**
 * Result of creating a test project.
 */
export interface TestProjectResult {
	/** Absolute path to the project root directory. */
	projectRoot: string;
	/** Cleanup function to remove the project directory. */
	cleanup: () => Promise<void>;
}

/**
 * Create a unique temporary directory, with its own cleanup. Backs
 * `withTestDir`, which is how tests reach it.
 *
 * @param prefix - Optional prefix for the directory name
 * @returns Object with path and cleanup function
 */
const createTestDir = async (
	prefix = 'svelte-docinfo-test'
): Promise<{ path: string; cleanup: () => Promise<void> }> => {
	const path = join(tmpdir(), `${prefix}-${Date.now()}`);
	await mkdir(path, { recursive: true });

	const cleanup = async () => {
		try {
			await rm(path, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	};

	return { path, cleanup };
};

/**
 * Run a test function with a temporary directory, handling cleanup automatically.
 *
 * @param fn - Test function receiving the directory path
 * @param prefix - Optional prefix for the directory name
 */
export const withTestDir = async (
	fn: (dir: string) => Promise<void>,
	prefix?: string
): Promise<void> => {
	const { path, cleanup } = await createTestDir(prefix);
	try {
		await fn(path);
	} finally {
		await cleanup();
	}
};

/**
 * Create a temporary test project with the specified files.
 *
 * This is a self-contained helper that creates its own unique directory.
 * Each call creates a fresh project directory with the provided files.
 *
 * By default includes a minimal tsconfig.json. Pass `tsconfig: false` to skip,
 * or provide your own tsconfig content in the files object.
 *
 * @param files - Map of relative file paths to their content
 * @param options - Optional configuration
 * @returns Object with projectRoot path and cleanup function
 *
 * @example
 * ```ts
 * const { projectRoot, cleanup } = await createTestProject({
 *   'src/lib/math.ts': 'export const add = (a: number, b: number) => a + b;',
 *   'src/lib/Button.svelte': '<script>let { label } = $props();</script><button>{label}</button>',
 * });
 *
 * try {
 *   // Run tests using projectRoot
 * } finally {
 *   await cleanup();
 * }
 * ```
 */
export const createTestProject = async (
	files: Record<string, string>,
	options: {
		/** Base directory for test projects. If not provided, uses os.tmpdir(). */
		baseDir?: string;
		/** Whether to include a default tsconfig.json. Default: true */
		tsconfig?: boolean;
	} = {}
): Promise<TestProjectResult> => {
	const { baseDir = tmpdir(), tsconfig = true } = options;

	// Create unique project directory
	const projectRoot = join(baseDir, `proj-${Date.now()}-${Math.random().toString(36).slice(2)}`);

	// Add default tsconfig if not provided
	const filesToWrite = { ...files };
	if (tsconfig && !filesToWrite['tsconfig.json']) {
		filesToWrite['tsconfig.json'] = JSON.stringify({
			compilerOptions: TEST_TSCONFIG_COMPILER_OPTIONS
		});
	}

	// Create all files
	for (const [relPath, content] of Object.entries(filesToWrite)) {
		const absPath = join(projectRoot, relPath);
		const dir = join(absPath, '..');
		await mkdir(dir, { recursive: true });
		await writeFile(absPath, content, 'utf-8');
	}

	const cleanup = async () => {
		try {
			await rm(projectRoot, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	};

	return { projectRoot, cleanup };
};

/**
 * Run a test function with a temporary test project, handling cleanup automatically.
 *
 * Eliminates the try/finally boilerplate pattern:
 * ```ts
 * const {projectRoot, cleanup} = await createTestProject(files);
 * try { ... } finally { await cleanup(); }
 * ```
 *
 * @param files - Map of relative file paths to their content
 * @param fn - Test function receiving the project root path
 * @param options - Optional configuration passed to createTestProject
 */
export const withTestProject = async <T = void>(
	files: Record<string, string>,
	fn: (projectRoot: string) => Promise<T>,
	options?: Parameters<typeof createTestProject>[1]
): Promise<T> => {
	const { projectRoot, cleanup } = await createTestProject(files, options);
	try {
		return await fn(projectRoot);
	} finally {
		await cleanup();
	}
};

/** Base directory for test fixtures. */
const FIXTURES_DIR = join(import.meta.dirname, 'fixtures');

/**
 * Directory for Svelte component fixtures. The ts and tsdoc sets need no
 * counterpart — their harnesses live inside the fixture directories and reach
 * their own via `import.meta.dirname`.
 */
export const FIXTURES_SVELTE_DIR = join(FIXTURES_DIR, 'svelte');

/**
 * Normalize an object by removing undefined values and empty arrays.
 * This matches compact JSON serialization behavior where undefined values
 * and empty arrays are omitted.
 *
 * Used to compare test results with expected.json files, since the compact
 * serializer strips empty arrays and JSON.stringify removes undefined values.
 *
 * Note: Treats both null and undefined as null for comparison consistency.
 *
 * @param obj - The object to normalize
 * @returns The normalized object without undefined values or empty arrays
 */
export const normalizeJson = (obj: any): any => {
	// Treat both null and undefined as null for comparison consistency
	if (obj === null || obj === undefined) return null;
	if (Array.isArray(obj)) {
		return obj.map(normalizeJson);
	}
	if (typeof obj === 'object') {
		const normalized: any = {};
		for (const [key, value] of Object.entries(obj)) {
			if (value === undefined) continue;
			if (value === false) continue; // Strip boolean defaults (restored by Zod .default(false))
			if (Array.isArray(value) && value.length === 0) continue;
			normalized[key] = normalizeJson(value);
		}
		return normalized;
	}
	return obj;
};

/**
 * Assert that a module has a specific dependency.
 *
 * @param module - The module to check
 * @param dependencyPath - The expected dependency path (can be partial, checks with endsWith)
 * @param message - Optional custom error message
 */
export const assertHasDependency = (
	module: ModuleJson,
	dependencyPath: string,
	message?: string
): void => {
	assert.ok(module.dependencies, message ?? `Expected ${module.path} to have dependencies`);
	assert.ok(
		module.dependencies.some((d) => d.endsWith(dependencyPath)),
		message ??
			`Expected ${module.path} to depend on ${dependencyPath}. Found: ${module.dependencies.join(', ')}`
	);
};

/**
 * Assert that a module has a specific dependent.
 *
 * @param module - The module to check
 * @param dependentPath - The expected dependent path (can be partial, checks with endsWith)
 * @param message - Optional custom error message
 */
export const assertHasDependent = (
	module: ModuleJson,
	dependentPath: string,
	message?: string
): void => {
	assert.ok(module.dependents, message ?? `Expected ${module.path} to have dependents`);
	assert.ok(
		module.dependents.some((d) => d.endsWith(dependentPath)),
		message ??
			`Expected ${module.path} to be depended upon by ${dependentPath}. Found: ${module.dependents.join(', ')}`
	);
};

/**
 * Assert that a module has a declaration with a specific name.
 *
 * @param module - The module to check
 * @param name - The expected declaration name
 * @returns The found declaration for further assertions
 */
export const assertHasDeclaration = (module: ModuleJson, name: string): DeclarationJson => {
	assert.ok(module.declarations, `Expected ${module.path} to have declarations`);
	const decl = module.declarations.find((d) => d.name === name);
	assert.ok(decl, `Expected ${module.path} to have declaration "${name}"`);
	return decl;
};

/**
 * Assert that a module has a component declaration with a specific name.
 *
 * Combines `assertHasDeclaration` with kind narrowing to `ComponentDeclarationJson`.
 *
 * @param module - The module to check
 * @param name - The expected component name
 * @returns The found component declaration, narrowed to `ComponentDeclarationJson`
 */
export const assertHasComponentDeclaration = (
	module: ModuleJson,
	name: string
): ComponentDeclarationJson => {
	const decl = assertHasDeclaration(module, name);
	assert.strictEqual(decl.kind, 'component', `Expected "${name}" to be a component`);
	if (decl.kind !== 'component') throw new Error(`Expected "${name}" to be a component`);
	return decl;
};

/**
 * Assert that a declaration has specific parameters.
 *
 * @param declaration - The declaration to check
 * @param paramNames - Array of expected parameter names
 */
export const assertHasParameters = (
	declaration: FunctionDeclarationJson,
	paramNames: Array<string>
): void => {
	assert.ok(
		declaration.parameters,
		`Expected declaration "${declaration.name}" to have parameters`
	);
	assert.strictEqual(
		declaration.parameters.length,
		paramNames.length,
		`Expected ${paramNames.length} parameters, got ${declaration.parameters.length}`
	);
	const actualNames = declaration.parameters.map((p) => p.name);
	assert.deepStrictEqual(
		actualNames,
		paramNames,
		`Parameter names don't match. Expected: ${paramNames.join(', ')}, Got: ${actualNames.join(', ')}`
	);
};

/**
 * Assert that a component declaration has specific props.
 *
 * @param declaration - The component declaration to check
 * @param propNames - Array of expected prop names
 */
export const assertHasProps = (
	declaration: ComponentDeclarationJson,
	propNames: Array<string>
): void => {
	assert.strictEqual(
		declaration.kind,
		'component',
		`Expected "${declaration.name}" to be a component`
	);
	assert.ok(declaration.props, `Expected component "${declaration.name}" to have props`);
	assert.strictEqual(
		declaration.props.length,
		propNames.length,
		`Expected ${propNames.length} props, got ${declaration.props.length}`
	);
	const actualNames = declaration.props.map((p) => p.name);
	assert.deepStrictEqual(
		actualNames,
		propNames,
		`Prop names don't match. Expected: ${propNames.join(', ')}, Got: ${actualNames.join(', ')}`
	);
};

/**
 * Find a module by path in an array of modules.
 *
 * @param modules - Array of modules to search
 * @param path - Module path to find (can be partial, uses endsWith)
 * @returns The found module
 * @throws If module not found
 */
export const findModule = (modules: Array<ModuleJson>, path: string): ModuleJson => {
	const module = modules.find((m) => m.path.endsWith(path));
	assert.ok(module, `Expected to find module with path ending in "${path}"`);
	return module;
};

/**
 * A sibling source file loaded from a multi-file fixture directory.
 *
 * `path` is fixture-dir-relative POSIX form (`dep.ts`, `internal/helper.ts`,
 * `external/extpkg/index.d.ts`) — the harness maps it to a synthetic project
 * location.
 */
export interface FixtureExtraFile {
	path: string;
	content: string;
}

/**
 * Generic fixture data structure.
 */
export interface GenericFixture<T> {
	name: string;
	input: string;
	expected: T;
	/**
	 * Sibling source files beside the input (multi-file fixtures). Present
	 * only when the loader was configured with `loadExtraFiles` and the
	 * fixture directory carries files beyond `input.*` + `expected.json`.
	 */
	extraFiles?: Array<FixtureExtraFile>;
}

/**
 * Generic fixture loader configuration.
 */
export interface FixtureLoaderConfig {
	/** Directory containing fixture subdirectories */
	fixturesDir: string;
	/** Input file extension (e.g., '.mdz', '.ts', '.svelte') */
	inputExtension: string;
	/**
	 * Collect sibling source files (recursive) beside the input file, for
	 * multi-file fixtures. Default `false`.
	 */
	loadExtraFiles?: boolean;
	/**
	 * Extensions collected as sibling files (`.d.ts` matches `.ts`). Default
	 * `DEFAULT_EXTRA_FILE_EXTENSIONS`. Per-set deliberately — each harness
	 * collects only what it can analyze: the ts harness feeds siblings straight
	 * to `analyzeCore`, so a collected `.svelte` sibling would arrive with no
	 * svelte2tsx virtual there, while the svelte harness transforms `.svelte`
	 * siblings itself and widens to `['.ts', '.svelte']`.
	 */
	extraFileExtensions?: Array<string>;
}

/** Default `extraFileExtensions` — see the config field for why it's per-set. */
const DEFAULT_EXTRA_FILE_EXTENSIONS = ['.ts'];

/**
 * Recursively collect a fixture directory's sibling source files — every
 * file matching `extensions` except the input file itself, with
 * fixture-dir-relative POSIX paths in `compareStrings` order.
 */
const loadFixtureExtraFiles = async (
	fixtureDir: string,
	inputExtension: string,
	extensions: Array<string>
): Promise<Array<FixtureExtraFile>> => {
	const inputName = `input${inputExtension}`;
	const paths: Array<string> = [];

	const scan = async (dir: string): Promise<void> => {
		const entries = await readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			const abs = join(dir, entry.name);
			if (entry.isDirectory()) {
				await scan(abs);
			} else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
				const rel = relative(fixtureDir, abs).replaceAll('\\', '/');
				if (rel !== inputName) paths.push(rel);
			}
		}
	};

	await scan(fixtureDir);
	paths.sort(compareStrings);
	return await Promise.all(
		paths.map(async (path) => ({
			path,
			content: await readFile(join(fixtureDir, path), 'utf-8')
		}))
	);
};

/**
 * Recursively discover fixture directories.
 * A fixture directory is one that contains an `input${extension}` file.
 *
 * @param baseDir - The base directory to search
 * @param inputExtension - The file extension to look for (e.g., '.svelte', '.ts')
 * @returns Array of {path: absolutePath, name: relativePath}
 */
const discoverFixtureDirs = async (
	baseDir: string,
	inputExtension: string
): Promise<Array<{ path: string; name: string }>> => {
	const results: Array<{ path: string; name: string }> = [];

	const scan = async (dir: string): Promise<void> => {
		const entries = await readdir(dir, { withFileTypes: true });

		// Check if this directory contains an input file
		const hasInputFile = entries.some(
			(entry) => entry.isFile() && entry.name === `input${inputExtension}`
		);

		if (hasInputFile) {
			// This is a fixture directory
			const name = relative(baseDir, dir);
			results.push({ path: dir, name });
		} else {
			// Recurse into subdirectories
			for (const entry of entries) {
				if (entry.isDirectory()) {
					await scan(join(dir, entry.name));
				}
			}
		}
	};

	await scan(baseDir);
	return results.sort((a, b) => compareStrings(a.name, b.name));
};

/**
 * Load all fixtures from a directory with the specified configuration.
 * Each fixture is a subdirectory containing an input file and expected.json.
 *
 * This generic pattern is used across mdz, tsdoc, ts, and svelte fixture loaders
 * to reduce duplication (~60 LOC saved).
 *
 * Supports both flat and nested directory structures. Fixtures are discovered recursively
 * by looking for directories containing `input${extension}` files.
 *
 * @example
 * ```ts
 * const fixtures = await loadFixturesGeneric<Array<MdzNode>>({
 *   fixturesDir: import.meta.dirname,
 *   inputExtension: '.mdz',
 * });
 * ```
 */
export const loadFixturesGeneric = async <T>(
	config: FixtureLoaderConfig
): Promise<Array<GenericFixture<T>>> => {
	const {
		fixturesDir,
		inputExtension,
		loadExtraFiles,
		extraFileExtensions = DEFAULT_EXTRA_FILE_EXTENSIONS
	} = config;

	// Recursively discover all fixture directories
	const fixtureDirs = await discoverFixtureDirs(fixturesDir, inputExtension);

	return await Promise.all(
		fixtureDirs.map(async ({ path: fixtureDir, name }) => {
			const input = await readFile(join(fixtureDir, `input${inputExtension}`), 'utf-8');
			const expectedText = await readFile(join(fixtureDir, 'expected.json'), 'utf-8');
			const fixture: GenericFixture<T> = { name, input, expected: JSON.parse(expectedText) };
			if (loadExtraFiles) {
				const extraFiles = await loadFixtureExtraFiles(
					fixtureDir,
					inputExtension,
					extraFileExtensions
				);
				if (extraFiles.length > 0) fixture.extraFiles = extraFiles;
			}
			return fixture;
		})
	);
};

/**
 * Configuration for the generic update task.
 */
export interface UpdateTaskConfig<TInput, TOutput> {
	/** Directory containing fixture subdirectories */
	fixturesDir: string;
	/** Input file extension */
	inputExtension: string;
	/**
	 * Collect sibling source files per fixture and pass them to `process` /
	 * `processAll` (multi-file fixtures). Default `false`.
	 */
	loadExtraFiles?: boolean;
	/** Extensions collected as sibling files — see `FixtureLoaderConfig`. */
	extraFileExtensions?: Array<string>;
	/**
	 * Process one input to generate its output. Exactly one of `process` /
	 * `processAll` must be supplied. `extraFiles` is populated only under
	 * `loadExtraFiles`, and only for fixtures that carry sibling files.
	 */
	process?: (
		input: TInput,
		name: string,
		extraFiles?: Array<FixtureExtraFile>
	) => Promise<TOutput> | TOutput;
	/**
	 * Batch form of `process`: receives every fixture at once (one discovery
	 * pass, one read per input) and returns outputs index-aligned with the
	 * input array — for harnesses that analyze the whole set against one
	 * shared program. `extraFiles` follows the same rule as `process`.
	 */
	processAll?: (
		fixtures: Array<{ name: string; input: TInput; extraFiles?: Array<FixtureExtraFile> }>
	) => Promise<Array<TOutput>> | Array<TOutput>;
	/**
	 * Custom JSON replacer for serialization.
	 * Use this for handling Maps, Sets, etc.
	 */
	jsonReplacer?: (key: string, value: any) => any;
}

/**
 * Generic update task runner for fixtures.
 * Handles the common pattern of reading fixtures, generating outputs,
 * comparing with existing files, and writing only changed files.
 *
 * This generic pattern is used across mdz, tsdoc, ts, and svelte update tasks
 * to reduce duplication (~240 LOC saved).
 *
 * @example
 * ```ts
 * export const task: Task = {
 *   summary: 'generate expected.json files',
 *   run: async ({log}) => {
 *     await runUpdateTask({
 *       fixturesDir: join(import.meta.dirname),
 *       inputExtension: '.mdz',
 *       process: (input) => mdz_parse(input),
 *     }, log);
 *   },
 * };
 * ```
 */
export const runUpdateTask = async <TInput = string, TOutput = any>(
	config: UpdateTaskConfig<TInput, TOutput>,
	log: { info: (msg: string) => void }
): Promise<{ generatedCount: number; skippedCount: number }> => {
	const {
		fixturesDir,
		inputExtension,
		loadExtraFiles,
		extraFileExtensions = DEFAULT_EXTRA_FILE_EXTENSIONS,
		process,
		processAll,
		jsonReplacer
	} = config;
	if (!process === !processAll) {
		throw new Error('runUpdateTask requires exactly one of `process` or `processAll`');
	}

	// Recursively discover all fixture directories
	const fixtureDirs = await discoverFixtureDirs(fixturesDir, inputExtension);

	log.info(`found ${fixtureDirs.length} fixtures`);

	const fixtures = await Promise.all(
		fixtureDirs.map(async ({ path: fixtureDir, name }) => {
			const extraFiles = loadExtraFiles
				? await loadFixtureExtraFiles(fixtureDir, inputExtension, extraFileExtensions)
				: [];
			return {
				name,
				expectedPath: join(fixtureDir, 'expected.json'),
				input: (await readFile(join(fixtureDir, `input${inputExtension}`), 'utf-8')) as TInput,
				extraFiles: extraFiles.length > 0 ? extraFiles : undefined
			};
		})
	);

	const outputs = processAll
		? await processAll(fixtures.map(({ name, input, extraFiles }) => ({ name, input, extraFiles })))
		: await Promise.all(
				fixtures.map(({ input, name, extraFiles }) => process!(input, name, extraFiles))
			);

	let generatedCount = 0;
	let skippedCount = 0;

	await Promise.all(
		fixtures.map(async ({ name, expectedPath }, i) => {
			const output = JSON.stringify(outputs[i], jsonReplacer, '\t') + '\n';

			let existing: string | null = null;
			try {
				existing = await readFile(expectedPath, 'utf-8');
			} catch (_error) {
				// File doesn't exist yet, proceed with write
			}

			if (existing === output) {
				skippedCount++;
				log.info(`skipped ${name}/expected.json`);
			} else {
				generatedCount++;
				await writeFile(expectedPath, output);
				log.info(`generated ${name}/expected.json`);
			}
		})
	);

	log.info(`done! generated: ${generatedCount}, skipped: ${skippedCount}`);
	return { generatedCount, skippedCount };
};
