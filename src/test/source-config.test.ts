/**
 * Tests for source-config.ts — configuration, path extraction, and file filtering.
 *
 * These tests cover:
 * - Path extraction and normalization (extractPath)
 * - Source detection (isSource)
 * - Source options validation and creation (normalizeSourceOptions, createSourceOptions, getSourceRoot)
 * - Default source options (DEFAULT_SOURCE_OPTIONS)
 * - Dependency extraction from SourceFileInfo (extractDependencies)
 */

import { test, assert, describe } from 'vitest';

import { type SourceFileInfo, getDefaultAnalyzer } from '$lib/source.ts';
import {
	extractPath,
	extractDependencies,
	isSource,
	normalizeSourceOptions,
	getSourceRoot,
	createSourceOptions,
	DEFAULT_SOURCE_OPTIONS,
	type ModuleSourceOptions
} from '$lib/source-config.ts';

import { testMockOptions } from './test-module-helpers.ts';
import { TEST_PATHS, TEST_FILES } from './test-constants.ts';

describe('extractPath', () => {
	test('extracts path from absolute source ID', () => {
		assert.strictEqual(extractPath(TEST_PATHS.ABSOLUTE_TS, testMockOptions()), TEST_FILES.TS);
	});

	test('extracts nested path', () => {
		assert.strictEqual(
			extractPath(TEST_PATHS.NESTED_SVELTE, testMockOptions()),
			'nested/Button.svelte'
		);
	});

	test('returns original path if projectRoot does not match', () => {
		assert.strictEqual(
			extractPath('/some/other/path.ts', testMockOptions()),
			'/some/other/path.ts'
		);
	});

	test('extracts path with custom sourceRoot', () => {
		const options = testMockOptions({
			sourcePaths: ['src/routes'],
			sourceRoot: 'src/routes'
		});
		assert.strictEqual(extractPath('/home/user/project/src/routes/page.ts', options), 'page.ts');
	});

	test('extracts nested path with custom sourceRoot', () => {
		const options = createSourceOptions('/home/user/project', {
			sourcePaths: ['packages/core/src'],
			sourceRoot: 'packages/core/src'
		});
		assert.strictEqual(
			extractPath('/home/user/project/packages/core/src/index.ts', options),
			'index.ts'
		);
	});

	test('returns original path if sourceRoot does not match', () => {
		const options = testMockOptions({
			sourcePaths: ['src/routes'],
			sourceRoot: 'src/routes'
		});
		assert.strictEqual(
			extractPath('/home/user/project/src/lib/foo.ts', options),
			'/home/user/project/src/lib/foo.ts'
		);
	});

	test('extracts path with multiple sourcePaths', () => {
		const options = testMockOptions({
			sourcePaths: ['src/lib', 'src/routes'],
			sourceRoot: 'src'
		});
		assert.strictEqual(extractPath('/home/user/project/src/lib/foo.ts', options), 'lib/foo.ts');
		assert.strictEqual(
			extractPath('/home/user/project/src/routes/page.svelte', options),
			'routes/page.svelte'
		);
	});

	test('extracts path with empty sourceRoot', () => {
		const options = testMockOptions({
			sourcePaths: ['lib', 'routes'],
			sourceRoot: ''
		});
		assert.strictEqual(extractPath('/home/user/project/lib/foo.ts', options), 'lib/foo.ts');
		assert.strictEqual(
			extractPath('/home/user/project/routes/page.svelte', options),
			'routes/page.svelte'
		);
	});
});

describe('DEFAULT_SOURCE_OPTIONS', () => {
	test('has expected default sourcePaths', () => {
		assert.deepStrictEqual(DEFAULT_SOURCE_OPTIONS.sourcePaths, ['src/lib']);
	});

	test('has expected default exclude globs', () => {
		assert.deepStrictEqual(DEFAULT_SOURCE_OPTIONS.exclude, ['**/*.test.ts', '**/*.spec.ts']);
	});

	test('has no sourceRoot (auto-derived from sourcePaths)', () => {
		assert.strictEqual(DEFAULT_SOURCE_OPTIONS.sourceRoot, undefined);
	});
});

describe('createSourceOptions', () => {
	test('creates options with projectRoot', () => {
		const options = createSourceOptions('/my/project');
		assert.strictEqual(options.projectRoot, '/my/project');
		assert.deepStrictEqual(options.sourcePaths, ['src/lib']);
	});

	test('resolves relative projectRoot to absolute', () => {
		const options = createSourceOptions('relative/path');
		assert.isTrue(options.projectRoot.startsWith('/'));
		assert.isTrue(options.projectRoot.endsWith('relative/path'));
	});

	test('merges overrides', () => {
		const options = createSourceOptions('/my/project', {
			sourcePaths: ['packages/core']
		});
		assert.strictEqual(options.projectRoot, '/my/project');
		assert.deepStrictEqual(options.sourcePaths, ['packages/core']);
	});
});

describe('getSourceRoot', () => {
	test('returns explicit sourceRoot when provided', () => {
		const options = testMockOptions({ sourceRoot: 'src' });
		assert.strictEqual(getSourceRoot(options), 'src');
	});

	test('returns empty string sourceRoot when explicitly set', () => {
		const options = testMockOptions({ sourceRoot: '' });
		assert.strictEqual(getSourceRoot(options), '');
	});

	test('returns first sourcePath for single-entry arrays', () => {
		const options = testMockOptions({ sourcePaths: ['src/lib'] });
		assert.strictEqual(getSourceRoot(options), 'src/lib');
	});

	test('auto-derives common prefix for multiple sourcePaths', () => {
		const options: ModuleSourceOptions = {
			projectRoot: '/home/user/project',
			sourcePaths: ['src/lib', 'src/routes'],
			exclude: [],
			getAnalyzerType: getDefaultAnalyzer
		};
		assert.strictEqual(getSourceRoot(options), 'src');
	});

	test('auto-derives empty string when no common prefix', () => {
		const options: ModuleSourceOptions = {
			projectRoot: '/home/user/project',
			sourcePaths: ['lib', 'routes'],
			exclude: [],
			getAnalyzerType: getDefaultAnalyzer
		};
		assert.strictEqual(getSourceRoot(options), '');
	});
});

describe('isSource', () => {
	describe('with default options', () => {
		test('matches src/lib TypeScript files', () => {
			assert.isTrue(isSource('/home/user/project/src/lib/foo.ts', testMockOptions()));
		});

		test('matches src/lib JS files', () => {
			assert.isTrue(isSource('/home/user/project/src/lib/foo.js', testMockOptions()));
		});

		test('matches src/lib Svelte files', () => {
			assert.isTrue(isSource('/home/user/project/src/lib/Button.svelte', testMockOptions()));
		});

		test('excludes test files', () => {
			assert.isFalse(isSource('/home/user/project/src/lib/foo.test.ts', testMockOptions()));
		});

		test('excludes files outside src/lib', () => {
			assert.isFalse(isSource('/home/user/project/src/routes/page.svelte', testMockOptions()));
		});

		test('matches src/lib CSS files', () => {
			assert.isTrue(isSource('/home/user/project/src/lib/styles.css', testMockOptions()));
		});

		test('matches src/lib JSON files', () => {
			assert.isTrue(isSource('/home/user/project/src/lib/data.json', testMockOptions()));
		});
	});

	describe('with custom sourcePaths', () => {
		test('respects custom source paths', () => {
			const options = testMockOptions({
				sourcePaths: ['src/routes']
			});

			assert.isTrue(isSource('/home/user/project/src/routes/page.svelte', options));
			assert.isFalse(isSource('/home/user/project/src/lib/foo.ts', options));
		});

		test('supports multiple source paths', () => {
			const options = testMockOptions({
				sourcePaths: ['src/lib', 'src/routes'],
				sourceRoot: 'src'
			});

			assert.isTrue(isSource('/home/user/project/src/lib/foo.ts', options));
			assert.isTrue(isSource('/home/user/project/src/routes/page.svelte', options));
		});
	});

	describe('with custom exclude globs', () => {
		test('respects custom exclude globs', () => {
			const options = testMockOptions({
				exclude: ['**/*.test.ts', '**/*.spec.ts']
			});

			assert.isTrue(isSource('/home/user/project/src/lib/foo.ts', options));
			assert.isFalse(isSource('/home/user/project/src/lib/foo.test.ts', options));
			assert.isFalse(isSource('/home/user/project/src/lib/foo.spec.ts', options));
		});

		test('can exclude by directory glob', () => {
			const options = testMockOptions({
				exclude: ['**/internal/**']
			});

			assert.isTrue(isSource('/home/user/project/src/lib/foo.ts', options));
			assert.isFalse(isSource('/home/user/project/src/lib/internal/secret.ts', options));
		});

		test('empty exclude includes everything', () => {
			const options = testMockOptions({
				exclude: []
			});

			assert.isTrue(isSource('/home/user/project/src/lib/foo.ts', options));
			assert.isTrue(isSource('/home/user/project/src/lib/foo.test.ts', options));
		});
	});

	describe('nested directories', () => {
		test('rejects nested repo paths - proper prefix matching', () => {
			assert.isFalse(
				isSource('/home/user/project/src/fixtures/repos/repoA/src/lib/index.ts', testMockOptions())
			);
			assert.isFalse(
				isSource(
					'/home/user/project/src/test/fixtures/repos/repoB/src/lib/foo.ts',
					testMockOptions()
				)
			);
		});

		test('rejects files from different project roots', () => {
			assert.isFalse(isSource('/home/user/other-project/src/lib/foo.ts', testMockOptions()));
		});

		test('accepts deeply nested paths within src/lib/', () => {
			assert.isTrue(
				isSource('/home/user/project/src/lib/utils/helpers/deep/file.ts', testMockOptions())
			);
		});
	});

	describe('non-src structures', () => {
		test('works with packages/ structure', () => {
			const options = createSourceOptions('/home/user/project', {
				sourcePaths: ['packages/core/lib']
			});

			assert.isTrue(isSource('/home/user/project/packages/core/lib/foo.ts', options));
			assert.isFalse(isSource('/home/user/project/packages/other/lib/foo.ts', options));
		});
	});
});

describe('extractDependencies', () => {
	describe('basic extraction', () => {
		test('extracts dependencies from source modules', () => {
			const sourceFile: SourceFileInfo = {
				id: '/home/user/project/src/lib/foo.ts',
				content: '',
				dependencies: ['/home/user/project/src/lib/bar.ts', '/home/user/project/src/lib/baz.ts']
			};

			const result = extractDependencies(sourceFile, testMockOptions());

			assert.deepStrictEqual(result.dependencies, ['bar.ts', 'baz.ts']);
			assert.deepStrictEqual(result.dependents, []);
		});

		test('extracts dependents from source modules', () => {
			const sourceFile: SourceFileInfo & { dependents?: ReadonlyArray<string> } = {
				id: '/home/user/project/src/lib/foo.ts',
				content: '',
				dependents: [
					'/home/user/project/src/lib/consumer1.ts',
					'/home/user/project/src/lib/consumer2.ts'
				]
			};

			const result = extractDependencies(sourceFile, testMockOptions());

			assert.deepStrictEqual(result.dependencies, []);
			assert.deepStrictEqual(result.dependents, ['consumer1.ts', 'consumer2.ts']);
		});

		test('extracts both dependencies and dependents', () => {
			const sourceFile: SourceFileInfo & { dependents?: ReadonlyArray<string> } = {
				id: '/home/user/project/src/lib/foo.ts',
				content: '',
				dependencies: ['/home/user/project/src/lib/dep.ts'],
				dependents: ['/home/user/project/src/lib/consumer.ts']
			};

			const result = extractDependencies(sourceFile, testMockOptions());

			assert.deepStrictEqual(result.dependencies, ['dep.ts']);
			assert.deepStrictEqual(result.dependents, ['consumer.ts']);
		});
	});

	describe('filtering', () => {
		test('excludes external packages (node_modules)', () => {
			const sourceFile: SourceFileInfo = {
				id: '/home/user/project/src/lib/foo.ts',
				content: '',
				dependencies: [
					'/home/user/project/src/lib/bar.ts',
					'/home/user/project/node_modules/svelte/index.js',
					'/home/user/project/node_modules/@fuzdev/fuz_util/index.js'
				]
			};

			const result = extractDependencies(sourceFile, testMockOptions());

			assert.deepStrictEqual(result.dependencies, ['bar.ts']);
		});

		test('excludes test files', () => {
			const sourceFile: SourceFileInfo = {
				id: '/home/user/project/src/lib/foo.ts',
				content: '',
				dependencies: [
					'/home/user/project/src/lib/bar.ts',
					'/home/user/project/src/lib/bar.test.ts'
				]
			};

			const result = extractDependencies(sourceFile, testMockOptions());

			assert.deepStrictEqual(result.dependencies, ['bar.ts']);
		});

		test('excludes files outside source paths', () => {
			const sourceFile: SourceFileInfo = {
				id: '/home/user/project/src/lib/foo.ts',
				content: '',
				dependencies: [
					'/home/user/project/src/lib/bar.ts',
					'/home/user/project/src/routes/page.svelte',
					'/home/user/project/src/test/helper.ts'
				]
			};

			const result = extractDependencies(sourceFile, testMockOptions());

			assert.deepStrictEqual(result.dependencies, ['bar.ts']);
		});
	});

	describe('sorting', () => {
		test('returns dependencies sorted alphabetically', () => {
			const sourceFile: SourceFileInfo = {
				id: '/home/user/project/src/lib/foo.ts',
				content: '',
				dependencies: [
					'/home/user/project/src/lib/zebra.ts',
					'/home/user/project/src/lib/alpha.ts',
					'/home/user/project/src/lib/beta.ts'
				]
			};

			const result = extractDependencies(sourceFile, testMockOptions());

			assert.deepStrictEqual(result.dependencies, ['alpha.ts', 'beta.ts', 'zebra.ts']);
		});

		test('returns dependents sorted alphabetically', () => {
			const sourceFile: SourceFileInfo & { dependents?: ReadonlyArray<string> } = {
				id: '/home/user/project/src/lib/foo.ts',
				content: '',
				dependents: [
					'/home/user/project/src/lib/z.ts',
					'/home/user/project/src/lib/a.ts',
					'/home/user/project/src/lib/m.ts'
				]
			};

			const result = extractDependencies(sourceFile, testMockOptions());

			assert.deepStrictEqual(result.dependents, ['a.ts', 'm.ts', 'z.ts']);
		});
	});

	describe('edge cases', () => {
		test('handles undefined dependencies', () => {
			const sourceFile: SourceFileInfo = {
				id: '/home/user/project/src/lib/foo.ts',
				content: ''
			};

			const result = extractDependencies(sourceFile, testMockOptions());

			assert.deepStrictEqual(result.dependencies, []);
			assert.deepStrictEqual(result.dependents, []);
		});

		test('handles empty arrays', () => {
			const sourceFile: SourceFileInfo & { dependents?: ReadonlyArray<string> } = {
				id: '/home/user/project/src/lib/foo.ts',
				content: '',
				dependencies: [],
				dependents: []
			};

			const result = extractDependencies(sourceFile, testMockOptions());

			assert.deepStrictEqual(result.dependencies, []);
			assert.deepStrictEqual(result.dependents, []);
		});

		test('works with custom source options', () => {
			const options = testMockOptions({
				sourcePaths: ['src/routes'],
				sourceRoot: 'src/routes',
				exclude: []
			});

			const sourceFile: SourceFileInfo = {
				id: '/home/user/project/src/routes/page.svelte',
				content: '',
				dependencies: [
					'/home/user/project/src/routes/Header.svelte',
					'/home/user/project/src/lib/util.ts', // excluded - wrong path
					'/home/user/project/src/routes/Footer.svelte'
				]
			};

			const result = extractDependencies(sourceFile, options);

			assert.deepStrictEqual(result.dependencies, ['Footer.svelte', 'Header.svelte']);
		});
	});
});

describe('normalizeSourceOptions', () => {
	describe('valid configurations', () => {
		test('accepts single sourcePath with auto-derived sourceRoot', () => {
			assert.doesNotThrow(() => normalizeSourceOptions(testMockOptions()));
		});

		test('accepts multiple sourcePaths with explicit sourceRoot', () => {
			assert.doesNotThrow(() =>
				normalizeSourceOptions(
					testMockOptions({
						sourcePaths: ['src/lib', 'src/routes'],
						sourceRoot: 'src'
					})
				)
			);
		});

		test('accepts sourceRoot equal to sourcePath', () => {
			assert.doesNotThrow(() =>
				normalizeSourceOptions(
					testMockOptions({
						sourcePaths: ['src/lib'],
						sourceRoot: 'src/lib'
					})
				)
			);
		});
	});

	// Helper to build invalid options — all share the same base shape
	const invalidOptions = (overrides: Partial<ModuleSourceOptions>): ModuleSourceOptions => ({
		projectRoot: '/home/user/project',
		sourcePaths: ['src/lib'],
		exclude: [],
		getAnalyzerType: getDefaultAnalyzer,
		...overrides
	});

	// [label, overrides, errorPattern]
	const VALIDATION_ERROR_CASES: Array<[string, Partial<ModuleSourceOptions>, RegExp]> = [
		['empty sourcePaths', { sourcePaths: [] }, /sourcePaths must have at least one entry/],
		[
			'sourcePath not under sourceRoot',
			{ sourcePaths: ['packages/core'], sourceRoot: 'src' },
			/sourcePaths entry "packages\/core" must start with sourceRoot "src"/
		]
	];

	describe('validation errors', () => {
		test.each(VALIDATION_ERROR_CASES)('throws on %s', (_label, overrides, pattern) => {
			assert.throws(() => normalizeSourceOptions(invalidOptions(overrides)), pattern);
		});

		test('multi-path layout with no common prefix auto-derives empty sourceRoot', () => {
			const result = normalizeSourceOptions(
				invalidOptions({ sourcePaths: ['src/lib', 'packages/core'] })
			);
			assert.strictEqual(result.sourceRoot, '');
		});

		test('explicit sourceRoot of "." normalizes to ""', () => {
			const result = normalizeSourceOptions(
				invalidOptions({ sourcePaths: ['src/lib', 'lib/utils'], sourceRoot: '.' })
			);
			assert.strictEqual(result.sourceRoot, '');
		});
	});

	describe('normalization', () => {
		test('resolves relative projectRoot to absolute', () => {
			const result = normalizeSourceOptions(invalidOptions({ projectRoot: 'relative/path' }));
			assert.isTrue(result.projectRoot.startsWith('/'));
		});

		test('strips trailing slash from projectRoot', () => {
			const result = normalizeSourceOptions(invalidOptions({ projectRoot: '/home/user/project/' }));
			assert.strictEqual(result.projectRoot, '/home/user/project');
		});

		test('strips leading slash from sourcePaths', () => {
			const result = normalizeSourceOptions(invalidOptions({ sourcePaths: ['/src/lib'] }));
			assert.deepStrictEqual(result.sourcePaths, ['src/lib']);
		});

		test('strips trailing slash from sourcePaths', () => {
			const result = normalizeSourceOptions(invalidOptions({ sourcePaths: ['src/lib/'] }));
			assert.deepStrictEqual(result.sourcePaths, ['src/lib']);
		});

		test('strips leading slash from sourceRoot', () => {
			const result = normalizeSourceOptions(invalidOptions({ sourceRoot: '/src' }));
			assert.strictEqual(result.sourceRoot, 'src');
		});

		test('strips trailing slash from sourceRoot', () => {
			const result = normalizeSourceOptions(invalidOptions({ sourceRoot: 'src/' }));
			assert.strictEqual(result.sourceRoot, 'src');
		});

		test('auto-derives sourceRoot for multiple sourcePaths', () => {
			const result = normalizeSourceOptions(
				invalidOptions({ sourcePaths: ['src/lib', 'src/routes'] })
			);
			assert.strictEqual(result.sourceRoot, 'src');
		});

		test('does not mutate the input', () => {
			const options = invalidOptions({
				projectRoot: 'relative/path/',
				sourcePaths: ['/src/lib/'],
				sourceRoot: '/src/'
			});
			const before = {
				projectRoot: options.projectRoot,
				sourcePaths: [...options.sourcePaths],
				sourceRoot: options.sourceRoot
			};
			normalizeSourceOptions(options);
			assert.strictEqual(options.projectRoot, before.projectRoot);
			assert.deepStrictEqual(options.sourcePaths, before.sourcePaths);
			assert.strictEqual(options.sourceRoot, before.sourceRoot);
		});

		test('returns a new object with a fresh identity', () => {
			const options = invalidOptions({ sourcePaths: ['src/lib'] });
			const result = normalizeSourceOptions(options);
			assert.notStrictEqual(result, options);
			assert.notStrictEqual(result.sourcePaths, options.sourcePaths);
		});

		test('is idempotent — re-normalizing already-normalized options yields equivalent result', () => {
			const first = normalizeSourceOptions(
				invalidOptions({
					projectRoot: 'relative/path/',
					sourcePaths: ['/src/lib/'],
					sourceRoot: '/src/'
				})
			);
			const second = normalizeSourceOptions(first);
			assert.strictEqual(second.projectRoot, first.projectRoot);
			assert.deepStrictEqual(second.sourcePaths, first.sourcePaths);
			assert.strictEqual(second.sourceRoot, first.sourceRoot);
		});
	});
});
