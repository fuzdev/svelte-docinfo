/**
 * Tests for the query-time source gate: owned/passed files outside
 * `sourcePaths` (or matching `exclude`) emit no module but still serve the
 * checker as in-memory content.
 *
 * The gate lives in `session.query()` — one-shot `analyze()` inherits it.
 * Locks the contracts: non-source inputs never become modules (out-of-root
 * TS, root config JSON, default-excluded test files); in-memory checker
 * context is preserved (the reason the gate is at query, not ingest — an
 * ingest gate would silently resolve imports against stale disk content),
 * including the Svelte virtual path (a non-source component's module-script
 * types resolve in source modules); non-source declarations don't
 * contaminate duplicate detection; `session.list()` keeps reporting the
 * full owned set; and `query()` logs the gated count as info (the gate
 * emits no diagnostics, so the log is the only trace of a misconfigured
 * `sourcePaths`).
 *
 * Also locks the source-scope hardening around the gate: the always-on
 * baseline (`node_modules` + dot-directories, matched relative to the
 * matched sourcePath), the out-of-root config throw, and the info log when
 * an include pattern scopes the whole project root.
 */

import { join } from 'node:path';
import { test, assert, describe } from 'vitest';

import { analyze, analyzeFromFiles } from '$lib/analyze.ts';
import { createAnalysisSession } from '$lib/session.ts';
import { createSourceOptions } from '$lib/source-config.ts';

import { withTestProject } from './test-helpers.ts';

describe('query-time source gate', () => {
	test('non-source inputs emit no module', async () => {
		const files: Record<string, string> = {
			'src/lib/a.ts': `export const a = 1;`,
			'src/lib/b.test.ts': `export const b_leaked = 2;`,
			'root-helper.ts': `export const root_leaked = 3;`,
			'package.json': JSON.stringify({ name: 'gate-test' })
		};
		const result = await withTestProject(files, (projectRoot) =>
			analyze({
				sourceFiles: Object.entries(files).map(([path, content]) => ({
					id: join(projectRoot, path),
					content
				})),
				sourceOptions: createSourceOptions(projectRoot)
			})
		);
		assert.deepStrictEqual(
			result.modules.map((m) => m.path),
			['a.ts'],
			'only the source file becomes a module'
		);
	});

	test('a non-source file still serves the checker as in-memory content', async () => {
		// helper.ts is never written to disk — resolution can only succeed
		// through the session-owned in-memory content. An ingest-time gate
		// would break exactly this.
		const diskFiles: Record<string, string> = {
			'src/lib/a.ts': `import type { Mode } from '../../helper.js';

export const m: Mode = 'x';`
		};
		const result = await withTestProject(diskFiles, (projectRoot) =>
			analyze({
				sourceFiles: [
					{
						id: join(projectRoot, 'src/lib/a.ts'),
						content: diskFiles['src/lib/a.ts']!
					},
					{
						id: join(projectRoot, 'helper.ts'),
						content: `export type Mode = 'x' | 'y';`
					}
				],
				sourceOptions: createSourceOptions(projectRoot)
			})
		);
		assert.deepStrictEqual(
			result.modules.map((m) => m.path),
			['a.ts'],
			'the context file emits no module'
		);
		const m = result.modules[0]?.declarations.find((d) => d.name === 'm');
		assert(m?.kind === 'variable', 'expected a variable declaration');
		// without the in-memory helper the import is unresolvable and the
		// annotation collapses to an error type
		assert.strictEqual(m.typeSignature, 'Mode');
		assert.deepStrictEqual(m.typeInfo, {
			kind: 'union',
			alias: 'Mode',
			members: [
				{ kind: 'literal', value: 'x', text: '"x"' },
				{ kind: 'literal', value: 'y', text: '"y"' }
			]
		});
	});

	test('a non-source Svelte file provides checker context through its virtual', async () => {
		// the gate must not starve the checker of non-source Svelte virtuals —
		// the module-script type resolves only through the ingested virtual
		const files: Record<string, string> = {
			'components/Hidden.svelte': `<script module lang="ts">\nexport type Mode = 'x' | 'y';\n</script>\n<div></div>`,
			'src/lib/uses_hidden.ts': `import type { Mode } from '../../components/Hidden.svelte';\n\nexport const m: Mode = 'x';`
		};
		const result = await withTestProject(files, (projectRoot) =>
			analyze({
				sourceFiles: Object.entries(files).map(([path, content]) => ({
					id: join(projectRoot, path),
					content
				})),
				sourceOptions: createSourceOptions(projectRoot)
			})
		);
		assert.deepStrictEqual(
			result.modules.map((m) => m.path),
			['uses_hidden.ts'],
			'the component emits no module'
		);
		const m = result.modules[0]?.declarations.find((d) => d.name === 'm');
		assert(m?.kind === 'variable', 'expected a variable declaration');
		assert.strictEqual(m.typeSignature, 'Mode');
		assert.deepStrictEqual(m.typeInfo, {
			kind: 'union',
			alias: 'Mode',
			members: [
				{ kind: 'literal', value: 'x', text: '"x"' },
				{ kind: 'literal', value: 'y', text: '"y"' }
			]
		});
		assert.strictEqual(result.diagnostics.length, 0);
	});

	test('non-source declarations do not contaminate duplicate detection', async () => {
		const files: Record<string, string> = {
			'src/lib/a.ts': `export const shared_name = 1;`,
			'src/lib/a.test.ts': `export const shared_name = 'test copy';`
		};
		const result = await withTestProject(files, (projectRoot) =>
			analyze({
				sourceFiles: Object.entries(files).map(([path, content]) => ({
					id: join(projectRoot, path),
					content
				})),
				sourceOptions: createSourceOptions(projectRoot),
				// would throw if the excluded test file's export were compared
				onDuplicates: 'throw'
			})
		);
		assert.strictEqual(result.modules.length, 1);
		assert.ok(
			!result.diagnostics.some((d) => d.kind === 'duplicate_declaration'),
			'no duplicate diagnostic from the gated file'
		);
	});

	test('explicit include beyond sourcePaths widens the source scope', async () => {
		// pre-gate, this workflow leaked modules with absolute paths and no
		// dependency edges (ingest's isSource filter dropped them); the widened
		// scope gives both a proper relative root and the edges
		const result = await withTestProject(
			{
				'src/lib/a.ts': `export const a = 1;`,
				'src/other/b.ts': `import { c } from './c.js';\nexport const b = c + 1;`,
				'src/other/c.ts': `export const c = 2;`
			},
			(projectRoot) =>
				analyzeFromFiles({
					projectRoot,
					include: ['src/other/**/*.ts']
				})
		);
		// sourceRoot derives from the widened set ['src/lib', 'src/other'] → 'src'
		assert.deepStrictEqual(
			result.modules.map((m) => m.path),
			['other/b.ts', 'other/c.ts']
		);
		const b = result.modules.find((m) => m.path === 'other/b.ts');
		assert.deepStrictEqual(b?.dependencies, ['other/c.ts']);
	});

	test('node_modules and dot-directory inputs below sourcePaths emit no module', async () => {
		const files: Record<string, string> = {
			'src/lib/a.ts': `export const a = 1;`,
			'src/lib/node_modules/leak.ts': `export const leaked_dep = 2;`,
			'src/lib/.generated/leak.ts': `export const leaked_gen = 3;`
		};
		const result = await withTestProject(files, (projectRoot) =>
			analyze({
				sourceFiles: Object.entries(files).map(([path, content]) => ({
					id: join(projectRoot, path),
					content
				})),
				sourceOptions: createSourceOptions(projectRoot)
			})
		);
		assert.deepStrictEqual(
			result.modules.map((m) => m.path),
			['a.ts'],
			'the baseline gates node_modules and dot-directories'
		);
	});

	test('a root-crossing include scopes the root, logs, and the baseline still holds', async () => {
		// the empirical failure mode the baseline closes: `--include '**/*.ts'`
		// used to emit node_modules files as clean-looking relative modules with
		// zero diagnostics; build/ is deliberately not baseline and stays in
		const infos: Array<string> = [];
		const result = await withTestProject(
			{
				'src/lib/a.ts': `export const a = 1;`,
				'build/generated.ts': `export const generated = 2;`,
				'node_modules/pkg/index.ts': `export const dep = 3;`,
				'.svelte-kit/generated/route.ts': `export const route = 4;`
			},
			(projectRoot) =>
				analyzeFromFiles({
					projectRoot,
					include: ['**/*.ts'],
					log: { info: (msg) => infos.push(msg), warn: () => {}, error: () => {} }
				})
		);
		assert.deepStrictEqual(
			result.modules.map((m) => m.path),
			['build/generated.ts', 'src/lib/a.ts']
		);
		assert.ok(
			infos.some((msg) => msg.includes('whole project root')),
			'the root-scoping include logs as info'
		);
	});

	test('an out-of-root include pattern fails loudly instead of emitting nothing', async () => {
		// pre-hardening: tinyglobby matched `..` patterns, the files ingested,
		// and the gate silently dropped every one — modules: [], zero diagnostics
		await withTestProject({ 'src/lib/a.ts': `export const a = 1;` }, async (projectRoot) => {
			let err: unknown;
			try {
				await analyzeFromFiles({ projectRoot, include: ['../other/**/*.ts'] });
			} catch (e) {
				err = e;
			}
			assert(err instanceof Error, 'expected analyzeFromFiles to throw');
			assert.match(err.message, /escapes projectRoot/);
		});
	});

	test('out-of-root sourcePaths throw at options creation', async () => {
		await withTestProject({ 'src/lib/a.ts': `export const a = 1;` }, async (projectRoot) => {
			assert.throws(
				() => createSourceOptions(projectRoot, { sourcePaths: ['../other'] }),
				/escapes projectRoot/
			);
		});
	});

	test('session.list() reports the full owned set; query emits the gated one', async () => {
		const files: Record<string, string> = {
			'src/lib/a.ts': `export const a = 1;`,
			'notes.ts': `export const notes = 2;`
		};
		await withTestProject(files, async (projectRoot) => {
			const session = createAnalysisSession({
				sourceOptions: createSourceOptions(projectRoot)
			});
			try {
				await session.setFiles(
					Object.entries(files).map(([path, content]) => ({
						id: join(projectRoot, path),
						content
					}))
				);
				assert.strictEqual(session.list().length, 2, 'both files are owned');
				const infos: Array<string> = [];
				const { modules } = session.query({
					log: { info: (msg) => infos.push(msg), warn: () => {}, error: () => {} }
				});
				assert.deepStrictEqual(
					modules.map((m) => m.path),
					['a.ts'],
					'only the source file is emitted'
				);
				// the gate emits no diagnostics — the info log is its only trace
				assert.ok(
					infos.some((msg) => msg.includes('1 of 2 owned files emit no module')),
					'the gated count logs as info'
				);
			} finally {
				session.dispose();
			}
		});
	});
});
