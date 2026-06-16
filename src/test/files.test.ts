/**
 * Tests for file system helpers (files.ts).
 *
 * These tests cover:
 * - loadFile - Loading single files from disk
 * - globFiles - File discovery via glob patterns
 * - deriveIncludePatterns - Build include glob array from source paths
 *
 * Dependency resolution moved into the session (see analyze.session.test.ts).
 */

import {test, assert, describe} from 'vitest';
import {join} from 'node:path';

import {loadFile, globFiles, deriveIncludePatterns} from '$lib/files.ts';

import {withTestProject} from './test-helpers.ts';

describe('loadFile', () => {
	test('loads file with absolute path', async () => {
		await withTestProject(
			{'src/lib/math.ts': 'export const add = (a: number, b: number) => a + b;'},
			async (projectRoot) => {
				const file = await loadFile(join(projectRoot, 'src/lib/math.ts'), projectRoot);

				assert.strictEqual(file.id, join(projectRoot, 'src/lib/math.ts'));
				assert.include(file.content, 'export const add');
			},
		);
	});

	test('loads file with relative path', async () => {
		await withTestProject({'src/lib/utils.ts': 'export const foo = 42;'}, async (projectRoot) => {
			const file = await loadFile('src/lib/utils.ts', projectRoot);

			assert.strictEqual(file.id, join(projectRoot, 'src/lib/utils.ts'));
			assert.include(file.content, 'foo');
		});
	});

	test('loads Svelte file', async () => {
		await withTestProject(
			{
				'src/lib/Button.svelte':
					'<script lang="ts">let {label}: {label: string} = $props();</script><button>{label}</button>',
			},
			async (projectRoot) => {
				const file = await loadFile('src/lib/Button.svelte', projectRoot);

				assert.strictEqual(file.id, join(projectRoot, 'src/lib/Button.svelte'));
				assert.include(file.content, 'button');
			},
		);
	});

	test('throws on non-existent file', async () => {
		await withTestProject({}, async (projectRoot) => {
			let errorThrown = false;
			try {
				await loadFile('nonexistent.ts', projectRoot);
			} catch (err: any) {
				errorThrown = true;
				assert.ok(err.code === 'ENOENT' || err.message.includes('ENOENT'));
			}
			assert.ok(errorThrown, 'Expected loadFile to throw for non-existent file');
		});
	});

	test('loads file with UTF-8 content', async () => {
		await withTestProject(
			{
				'src/lib/unicode.ts': '// Comment with emoji: 🎉\nexport const greeting = "Hello, 世界!";',
			},
			async (projectRoot) => {
				const file = await loadFile('src/lib/unicode.ts', projectRoot);

				assert.include(file.content, '🎉');
				assert.include(file.content, '世界');
			},
		);
	});
});

describe('globFiles', () => {
	test('discovers TypeScript files with basic glob', async () => {
		await withTestProject(
			{
				'src/lib/foo.ts': 'export const foo = 1;',
				'src/lib/bar.ts': 'export const bar = 2;',
				'src/lib/baz.ts': 'export const baz = 3;',
			},
			async (projectRoot) => {
				const files = await globFiles({
					projectRoot,
					include: ['src/lib/**/*.ts'],
				});

				assert.strictEqual(files.length, 3);
				assert.ok(files.some((f) => f.id.endsWith('foo.ts')));
				assert.ok(files.some((f) => f.id.endsWith('bar.ts')));
				assert.ok(files.some((f) => f.id.endsWith('baz.ts')));
			},
		);
	});

	test('discovers mixed file types with multi-extension glob', async () => {
		await withTestProject(
			{
				'src/lib/utils.ts': 'export const util = 1;',
				'src/lib/Button.svelte': '<button>Click</button>',
				'src/lib/helpers.js': 'export const helper = 2;',
			},
			async (projectRoot) => {
				const files = await globFiles({
					projectRoot,
					include: ['src/lib/**/*.{ts,js,svelte}'],
				});

				assert.strictEqual(files.length, 3);
				assert.ok(files.some((f) => f.id.endsWith('.ts')));
				assert.ok(files.some((f) => f.id.endsWith('.svelte')));
				assert.ok(files.some((f) => f.id.endsWith('.js')));
			},
		);
	});

	test('excludes files matching exclude pattern', async () => {
		await withTestProject(
			{
				'src/lib/foo.ts': 'export const foo = 1;',
				'src/lib/foo.test.ts': 'test("foo", () => {});',
				'src/lib/bar.ts': 'export const bar = 2;',
			},
			async (projectRoot) => {
				const files = await globFiles({
					projectRoot,
					include: ['src/lib/**/*.ts'],
					exclude: ['**/*.test.ts'],
				});

				assert.strictEqual(files.length, 2);
				assert.ok(files.some((f) => f.id.endsWith('foo.ts') && !f.id.includes('.test')));
				assert.ok(files.some((f) => f.id.endsWith('bar.ts')));
			},
		);
	});

	test('handles nested directory structure', async () => {
		await withTestProject(
			{
				'src/lib/utils/math.ts': 'export const add = 1;',
				'src/lib/utils/string.ts': 'export const trim = 2;',
				'src/lib/components/Button.svelte': '<button></button>',
				'src/lib/types/index.ts': 'export type Foo = string;',
			},
			async (projectRoot) => {
				const files = await globFiles({
					projectRoot,
					include: ['src/lib/**/*.{ts,svelte}'],
				});

				assert.strictEqual(files.length, 4);
				assert.ok(files.some((f) => f.id.includes('utils/math.ts')));
				assert.ok(files.some((f) => f.id.includes('components/Button.svelte')));
			},
		);
	});

	test('returns empty array when no files match', async () => {
		await withTestProject(
			{
				'src/lib/foo.txt': 'plain text',
				'src/lib/bar.md': '# Markdown',
			},
			async (projectRoot) => {
				const files = await globFiles({
					projectRoot,
					include: ['src/lib/**/*.ts'],
				});

				assert.strictEqual(files.length, 0);
			},
		);
	});

	test('returns files with content loaded', async () => {
		await withTestProject(
			{'src/lib/foo.ts': 'export const foo = "test content";'},
			async (projectRoot) => {
				const files = await globFiles({
					projectRoot,
					include: ['src/lib/**/*.ts'],
				});

				assert.strictEqual(files.length, 1);
				assert.include(files[0]!.content, 'test content');
			},
		);
	});

	test('handles multiple include patterns', async () => {
		await withTestProject(
			{
				'src/lib/utils.ts': 'export const util = 1;',
				'src/components/Button.svelte': '<button></button>',
			},
			async (projectRoot) => {
				const files = await globFiles({
					projectRoot,
					include: ['src/lib/**/*.ts', 'src/components/**/*.svelte'],
				});

				assert.strictEqual(files.length, 2);
			},
		);
	});

	test('returns absolute paths in file.id', async () => {
		await withTestProject({'src/lib/foo.ts': 'export const foo = 1;'}, async (projectRoot) => {
			const files = await globFiles({
				projectRoot,
				include: ['src/lib/**/*.ts'],
			});

			assert.strictEqual(files.length, 1);
			assert.ok(files[0]!.id.startsWith('/') || /^[A-Z]:\\/.test(files[0]!.id)); // Unix or Windows absolute path
			assert.strictEqual(files[0]!.id, join(projectRoot, 'src/lib/foo.ts'));
		});
	});

	// Trip-wire: `globFiles` uses `map_concurrent` with `MAX_FILE_CONCURRENCY = 100`.
	// A previous unbounded `Promise.all` could trip `EMFILE` on large projects;
	// the bound prevents that. This test just verifies the bound doesn't break
	// loading more than 100 files.
	test('loads more files than the FD concurrency cap without error', async () => {
		const N = 250;
		const fixtures: Record<string, string> = {};
		for (let i = 0; i < N; i++) {
			fixtures[`src/lib/file${i}.ts`] = `export const v${i} = ${i};\n`;
		}
		await withTestProject(fixtures, async (projectRoot) => {
			const files = await globFiles({
				projectRoot,
				include: ['src/lib/**/*.ts'],
			});
			assert.strictEqual(files.length, N);
			// Spot-check content loaded correctly under bounded concurrency.
			const f0 = files.find((f) => f.id.endsWith('file0.ts'))!;
			assert.include(f0.content, 'export const v0 = 0;');
		});
	});
});

describe('deriveIncludePatterns', () => {
	test('builds one glob per source path', () => {
		assert.deepStrictEqual(deriveIncludePatterns(['packages/foo']), [
			'packages/foo/**/*.{ts,js,svelte,css,json}',
		]);
		assert.deepStrictEqual(deriveIncludePatterns(['src/lib', 'src/routes']), [
			'src/lib/**/*.{ts,js,svelte,css,json}',
			'src/routes/**/*.{ts,js,svelte,css,json}',
		]);
	});

	test('returns an empty array for an empty input', () => {
		assert.deepStrictEqual(deriveIncludePatterns([]), []);
	});
});
