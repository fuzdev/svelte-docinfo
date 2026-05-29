/**
 * Tests for the Vite plugin (vite.ts).
 *
 * These tests cover:
 * - Plugin factory returns correct structure and hooks
 * - Virtual module ID resolution
 * - Source file detection for watcher scope
 * - Serving a valid empty-modules virtual module for projects with no source files
 */

import {test, assert, describe} from 'vitest';
import {mkdtemp, rm, writeFile, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import svelteDocinfo from '$lib/vite.js';

const withTempProject = async (
	files: Record<string, string>,
	fn: (dir: string) => Promise<void>,
): Promise<void> => {
	const dir = await mkdtemp(join(tmpdir(), 'svelte-docinfo-vite-'));
	try {
		for (const [path, content] of Object.entries(files)) {
			const full = join(dir, path);
			await mkdir(join(full, '..'), {recursive: true});
			await writeFile(full, content);
		}
		await fn(dir);
	} finally {
		await rm(dir, {recursive: true, force: true});
	}
};

describe('svelteDocinfo', () => {
	test('returns a plugin with the expected name', () => {
		const plugin = svelteDocinfo();
		assert.equal(plugin.name, 'vite-plugin-svelte-docinfo');
	});

	test('has all expected hooks', () => {
		const plugin = svelteDocinfo();
		assert.typeOf(plugin.configResolved, 'function');
		assert.typeOf(plugin.buildStart, 'function');
		assert.typeOf(plugin.resolveId, 'function');
		assert.typeOf(plugin.load, 'function');
		assert.typeOf(plugin.configureServer, 'function');
	});

	test('resolveId maps virtual:svelte-docinfo', () => {
		const plugin = svelteDocinfo();
		const resolveId = plugin.resolveId as (id: string) => string | undefined;
		assert.equal(resolveId('virtual:svelte-docinfo'), '\0virtual:svelte-docinfo');
	});

	test('resolveId returns undefined for other IDs', () => {
		const plugin = svelteDocinfo();
		const resolveId = plugin.resolveId as (id: string) => string | undefined;
		assert.equal(resolveId('some-other-module'), undefined);
		assert.equal(resolveId('virtual:other'), undefined);
	});

	test('load returns undefined for non-virtual IDs', async () => {
		const plugin = svelteDocinfo();
		const load = plugin.load as (id: string) => Promise<string | undefined>;
		assert.equal(await load('some-other-id'), undefined);
	});

	test('accepts custom options without error', () => {
		const plugin = svelteDocinfo({
			include: ['src/**/*.ts'],
			exclude: ['**/*.test.ts'],
			resolveDependencies: false,
			discovery: 'glob',
			hmrDebounceMs: 200,
		});
		assert.ok(plugin);
		assert.equal(plugin.name, 'vite-plugin-svelte-docinfo');
	});

	// Regression for empty-modules root serialization: `JSON.stringify([], compactReplacer)`
	// returns the JS value `undefined`, which template-literal interpolates as "undefined".
	// `updateOutputFromQuery` short-circuits to the literal `'[]'` for empty `modules`
	// arrays so the virtual module emits valid JS for projects with zero source files.
	test('emits valid JS for projects with no source files', async () => {
		// `createAnalysisSession` builds a `ts.LanguageService` whose host calls
		// `loadTsconfig`; an empty project still needs a tsconfig.json to satisfy
		// that. Beyond that, `discovery: 'glob'` with no source files tests the
		// path that produced finding #1.
		await withTempProject({'tsconfig.json': '{}'}, async (dir) => {
			const plugin = svelteDocinfo({
				projectRoot: dir,
				discovery: 'glob',
				resolveDependencies: false,
			});
			// Drive the lifecycle hooks the way Vite would, with the minimum
			// surface needed to reach `runInitialAnalysis` → `updateOutputFromQuery`.
			// `configResolved` / `buildStart` are typed as Rollup `ObjectHook`s
			// at the Vite layer; cast through `unknown` to call the underlying
			// function form directly.
			const configResolved = plugin.configResolved as unknown as (cfg: {
				root: string;
				command: string;
				logger: {info: () => void; warn: () => void; error: () => void};
			}) => void;
			const noopLogger = {info: () => {}, warn: () => {}, error: () => {}};
			configResolved({root: dir, command: 'build', logger: noopLogger});

			const buildStart = plugin.buildStart as unknown as (this: {
				resolve: () => Promise<null>;
			}) => Promise<void>;
			await buildStart.call({resolve: async () => null});

			const load = plugin.load as (id: string) => Promise<string | undefined>;
			const code = await load('\0virtual:svelte-docinfo');
			assert.ok(code, 'expected virtual module code');
			assert.include(code, 'export const modules = [];');
			assert.notInclude(code, 'export const modules = undefined;');
		});
	});
});
