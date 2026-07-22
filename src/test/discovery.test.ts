/**
 * Tests for `discoverSourceFiles` (discovery.ts).
 *
 * Focuses on the glob-fallback include derivation — `discoverSourceFiles`
 * derives a default `include` from `sourceOptions.sourcePaths` when no
 * explicit pattern is supplied, so custom source layouts survive the
 * fallback instead of silently defaulting to `src/lib`.
 */

import { test, assert, describe } from 'vitest';

import { discoverSourceFiles } from '$lib/discovery.ts';
import { createSourceOptions } from '$lib/source-config.ts';

import { withTestProject } from './test-helpers.ts';

describe('discoverSourceFiles', () => {
	test('derives include from sourcePaths when no include is supplied (glob mode)', async () => {
		await withTestProject(
			{
				'packages/foo/a.ts': 'export const a = 1;',
				'packages/foo/nested/b.ts': 'export const b = 2;',
				'src/lib/elsewhere.ts': 'export const c = 3;'
			},
			async (projectRoot) => {
				const sourceOptions = createSourceOptions(projectRoot, {
					sourcePaths: ['packages/foo']
				});
				const { files } = await discoverSourceFiles({
					sourceOptions,
					discovery: 'glob'
				});

				const ids = files.map((f) => f.id).sort();
				assert.strictEqual(files.length, 2);
				assert.ok(ids.every((id) => id.includes('/packages/foo/')));
				assert.ok(!ids.some((id) => id.includes('elsewhere.ts')));
			}
		);
	});

	test('derives include from multiple sourcePaths (glob mode)', async () => {
		await withTestProject(
			{
				'packages/foo/a.ts': 'export const a = 1;',
				'packages/bar/b.ts': 'export const b = 2;',
				'src/lib/elsewhere.ts': 'export const c = 3;'
			},
			async (projectRoot) => {
				const sourceOptions = createSourceOptions(projectRoot, {
					sourcePaths: ['packages/foo', 'packages/bar'],
					sourceRoot: 'packages'
				});
				const { files } = await discoverSourceFiles({
					sourceOptions,
					discovery: 'glob'
				});

				const ids = files.map((f) => f.id).sort();
				assert.strictEqual(files.length, 2);
				assert.ok(ids.some((id) => id.endsWith('packages/foo/a.ts')));
				assert.ok(ids.some((id) => id.endsWith('packages/bar/b.ts')));
				assert.ok(!ids.some((id) => id.includes('elsewhere.ts')));
			}
		);
	});

	test('explicit include overrides the sourcePaths-derived default', async () => {
		// Sanity check: when the caller passes `include`, we use it as-is and
		// don't quietly broaden the search to the full sourcePaths tree.
		await withTestProject(
			{
				'packages/foo/keep/a.ts': 'export const a = 1;',
				'packages/foo/skip/b.ts': 'export const b = 2;'
			},
			async (projectRoot) => {
				const sourceOptions = createSourceOptions(projectRoot, {
					sourcePaths: ['packages/foo']
				});
				const { files } = await discoverSourceFiles({
					sourceOptions,
					include: ['packages/foo/keep/**/*.ts'],
					discovery: 'glob'
				});

				assert.strictEqual(files.length, 1);
				assert.ok(files[0]!.id.endsWith('keep/a.ts'));
			}
		);
	});

	test("'auto' skips exports when sourcePaths share no common prefix, falling back to glob", async () => {
		// Multi-sourcePaths with no common prefix → auto-derived sourceRoot=''.
		// Exports discovery's single-sourceDir model cannot represent this layout
		// (every dist mapping would resolve to project root). Skip exports under
		// 'auto' and fall back to glob (which is sourcePaths-aware).
		await withTestProject(
			{
				'src/lib/a.ts': 'export const a = 1;',
				'lib/utils/b.ts': 'export const b = 2;',
				// package.json with exports field — would normally trigger exports discovery
				'package.json': JSON.stringify({
					name: 'test-pkg',
					exports: { './*': './dist/*.js' }
				})
			},
			async (projectRoot) => {
				const sourceOptions = createSourceOptions(projectRoot, {
					sourcePaths: ['src/lib', 'lib/utils']
				});
				const { files } = await discoverSourceFiles({ sourceOptions });

				// Glob fallback finds both files via deriveIncludePatterns
				const ids = files.map((f) => f.id).sort();
				assert.strictEqual(files.length, 2);
				assert.ok(ids.some((id) => id.endsWith('src/lib/a.ts')));
				assert.ok(ids.some((id) => id.endsWith('lib/utils/b.ts')));
			}
		);
	});

	test("'exports' throws a layout-specific error when sourcePaths share no common prefix", async () => {
		await withTestProject(
			{
				'src/lib/a.ts': 'export const a = 1;',
				'lib/utils/b.ts': 'export const b = 2;',
				'package.json': JSON.stringify({
					name: 'test-pkg',
					exports: { './*': './dist/*.js' }
				})
			},
			async (projectRoot) => {
				const sourceOptions = createSourceOptions(projectRoot, {
					sourcePaths: ['src/lib', 'lib/utils']
				});
				let caught: Error | undefined;
				try {
					await discoverSourceFiles({ sourceOptions, discovery: 'exports' });
				} catch (err) {
					caught = err as Error;
				}
				assert.ok(caught, 'Expected discoverSourceFiles to throw');
				assert.match(caught.message, /source paths share no common prefix/);
				// Must NOT fall back to the generic "resolved to no source files" message.
				assert.notMatch(caught.message, /resolved to no source files/);
			}
		);
	});

	test('default sourcePaths fall back to src/lib in glob mode', async () => {
		// Regression guard: changing the include-derivation must not break
		// the everyday default-shaped library.
		await withTestProject(
			{
				'src/lib/a.ts': 'export const a = 1;',
				'src/lib/nested/b.ts': 'export const b = 2;',
				'other/c.ts': 'export const c = 3;'
			},
			async (projectRoot) => {
				const sourceOptions = createSourceOptions(projectRoot);
				const { files } = await discoverSourceFiles({
					sourceOptions,
					discovery: 'glob'
				});

				assert.strictEqual(files.length, 2);
				assert.ok(files.every((f) => f.id.includes('/src/lib/')));
			}
		);
	});
});
