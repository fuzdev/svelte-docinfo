/**
 * Tests for the Vite plugin (vite.ts).
 *
 * These tests cover:
 * - Plugin factory returns correct structure and hooks
 * - Virtual module ID resolution
 * - Source file detection for watcher scope
 * - Serving a valid empty-modules virtual module for projects with no source files
 */

import { test, assert, describe } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import svelteDocinfo from '$lib/vite.ts';

const withTempProject = async (
	files: Record<string, string>,
	fn: (dir: string) => Promise<void>
): Promise<void> => {
	const dir = await mkdtemp(join(tmpdir(), 'svelte-docinfo-vite-'));
	try {
		for (const [path, content] of Object.entries(files)) {
			const full = join(dir, path);
			await mkdir(join(full, '..'), { recursive: true });
			await writeFile(full, content);
		}
		await fn(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
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
			hmrDebounceMs: 200
		});
		assert.ok(plugin);
		assert.equal(plugin.name, 'vite-plugin-svelte-docinfo');
	});

	// Regression: in build mode (no dev server) the plugin must resolve
	// dependencies through the session's TS-based default resolver, NOT Rollup's
	// `this.resolve`. Routing analysis through `this.resolve` mutates the active
	// build's module graph, so resolving a bare package specifier from the
	// analyzed source drags the toolchain (vite/rollup/esbuild) into the client
	// bundle and floods the log with "externalized for browser" warnings. The
	// recording `this.resolve` mock below must never be called, and the `a → b`
	// relative edge must still resolve via TS.
	test('build mode resolves deps via TS default, never calling this.resolve', async () => {
		await withTempProject(
			{
				'tsconfig.json': JSON.stringify({
					compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext' },
					include: ['src/**/*.ts']
				}),
				'src/lib/a.ts': "import {b} from './b.js';\nexport const a = b + 1;\n",
				'src/lib/b.ts': 'export const b = 1;\n'
			},
			async (dir) => {
				// `resolveDependencies` defaults to `true`, so this exercises the
				// build-resolver branch (the dev branch needs a server).
				const plugin = svelteDocinfo({
					projectRoot: dir,
					discovery: 'glob',
					include: ['src/**/*.ts']
				});
				const configResolved = plugin.configResolved as unknown as (cfg: {
					root: string;
					command: string;
					logger: { info: () => void; warn: () => void; error: () => void };
				}) => void;
				const noopLogger = { info: () => {}, warn: () => {}, error: () => {} };
				configResolved({ root: dir, command: 'build', logger: noopLogger });

				let resolveCalls = 0;
				const buildStart = plugin.buildStart as unknown as (this: {
					resolve: (s: string, f: string) => Promise<null>;
				}) => Promise<void>;
				await buildStart.call({
					resolve: async () => {
						resolveCalls++;
						return null;
					}
				});
				assert.equal(
					resolveCalls,
					0,
					'build mode must not route dep resolution through this.resolve'
				);

				const load = plugin.load as (id: string) => Promise<string | undefined>;
				const code = await load('\0virtual:svelte-docinfo');
				assert.ok(code, 'expected virtual module code');
				const line = code.split('\n').find((l) => l.startsWith('export const modules = '));
				assert.ok(line, 'expected modules export line');
				const modules = JSON.parse(line.slice('export const modules = '.length, -1)) as Array<{
					path: string;
					dependencies?: Array<string>;
				}>;
				const a = modules.find((m) => m.path === 'a.ts');
				assert.ok(a, 'expected a.ts module');
				assert.deepEqual(a.dependencies, ['b.ts'], 'relative edge a → b resolved via TS default');
			}
		);
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
		await withTempProject({ 'tsconfig.json': '{}' }, async (dir) => {
			const plugin = svelteDocinfo({
				projectRoot: dir,
				discovery: 'glob',
				resolveDependencies: false
			});
			// Drive the lifecycle hooks the way Vite would, with the minimum
			// surface needed to reach `runInitialAnalysis` → `updateOutputFromQuery`.
			// `configResolved` / `buildStart` are typed as Rollup `ObjectHook`s
			// at the Vite layer; cast through `unknown` to call the underlying
			// function form directly.
			const configResolved = plugin.configResolved as unknown as (cfg: {
				root: string;
				command: string;
				logger: { info: () => void; warn: () => void; error: () => void };
			}) => void;
			const noopLogger = { info: () => {}, warn: () => {}, error: () => {} };
			configResolved({ root: dir, command: 'build', logger: noopLogger });

			const buildStart = plugin.buildStart as unknown as (this: {
				resolve: () => Promise<null>;
			}) => Promise<void>;
			await buildStart.call({ resolve: async () => null });

			const load = plugin.load as (id: string) => Promise<string | undefined>;
			const code = await load('\0virtual:svelte-docinfo');
			assert.ok(code, 'expected virtual module code');
			assert.include(code, 'export const modules = [];');
			assert.notInclude(code, 'export const modules = undefined;');
		});
	});
});
