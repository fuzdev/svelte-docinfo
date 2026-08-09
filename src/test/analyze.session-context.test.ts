/**
 * Tests for the session's context-closure ownership
 * (`AnalysisSessionOptions.contextClosure`).
 *
 * The closure completes "owned ⊇ emitted" from the session's own side: after
 * each ingest batch, in-root non-source files the batch's imports resolved to
 * (e.g. `src/lib/internal/` modules) are read from disk and ingested as
 * context files — owned and version-tracked, but gated from output by
 * `query()`. What this buys is freshness: a `setFile` on a context file
 * version-bumps the LS, so public output tracks internal type edits without
 * a session restart. Disk-resolved files, by contrast, are read once and
 * pinned for the session's lifetime.
 *
 * Locked contracts: transitive closure convergence; `query()` output
 * unchanged by context ownership (no modules, no dependency edges);
 * staleness recovery on context-file edits; `node_modules` and analyzer-less
 * files never ingested; `contextClosure: false` opts out; `setFiles` results
 * stay keyed by the caller's input IDs.
 */

import { test, assert, describe } from 'vitest';
import { join } from 'node:path';

import { createAnalysisSession } from '$lib/session.ts';
import { createSourceOptions } from '$lib/source-config.ts';

import { withTestProject } from './test-helpers.ts';

describe('session context closure', () => {
	test('ingests the in-root non-source dependency closure transitively', async () => {
		const files: Record<string, string> = {
			'src/lib/internal/base.ts': `export const base = 1;`,
			'src/lib/internal/mid.ts': `import { base } from './base.ts';\nexport const mid = base;`,
			'src/lib/api.ts': `import { mid } from './internal/mid.ts';\nexport const out = mid;`
		};
		await withTestProject(files, async (projectRoot) => {
			const session = createAnalysisSession({
				sourceOptions: createSourceOptions(projectRoot)
			});
			try {
				const apiId = join(projectRoot, 'src/lib/api.ts');
				const result = await session.setFiles([{ id: apiId, content: files['src/lib/api.ts']! }]);

				// The batch result stays keyed by the caller's inputs.
				assert.deepStrictEqual([...result.perFile.keys()], [apiId]);

				// Both internal files are owned — the closure walked mid → base.
				assert.isTrue(session.has(join(projectRoot, 'src/lib/internal/mid.ts')));
				assert.isTrue(session.has(join(projectRoot, 'src/lib/internal/base.ts')));

				// Output is unchanged by context ownership: one module, no edges
				// to gated files.
				const query = session.query();
				assert.deepStrictEqual(
					query.modules.map((m) => m.path),
					['api.ts']
				);
				assert.deepStrictEqual(query.modules[0]?.dependencies, []);
			} finally {
				session.dispose();
			}
		});
	});

	test('a context-file edit propagates to public output without a restart', async () => {
		const files: Record<string, string> = {
			'src/lib/internal/helper.ts': `export const width: number = 1;`,
			'src/lib/api.ts': `import { width } from './internal/helper.ts';\nexport const w = width;`
		};
		await withTestProject(files, async (projectRoot) => {
			const session = createAnalysisSession({
				sourceOptions: createSourceOptions(projectRoot)
			});
			try {
				const apiId = join(projectRoot, 'src/lib/api.ts');
				const helperId = join(projectRoot, 'src/lib/internal/helper.ts');
				await session.setFiles([{ id: apiId, content: files['src/lib/api.ts']! }]);

				const before = session.query();
				const wBefore = before.modules[0]?.declarations.find((d) => d.name === 'w');
				assert(wBefore?.kind === 'variable');
				assert.strictEqual(wBefore.typeSignature, 'number');

				// Simulate a watcher event on the internal file. The closure made
				// it owned, so this version-bumps instead of no-oping against the
				// pinned disk read.
				const changed = await session.setFile({
					id: helperId,
					content: `export const width: string = 'wide';`
				});
				assert.isTrue(changed.changed);

				const after = session.query();
				const wAfter = after.modules[0]?.declarations.find((d) => d.name === 'w');
				assert(wAfter?.kind === 'variable');
				assert.strictEqual(wAfter.typeSignature, 'string');
			} finally {
				session.dispose();
			}
		});
	});

	test('node_modules dependencies are never ingested as context', async () => {
		const files: Record<string, string> = {
			'node_modules/mypkg/package.json': JSON.stringify({
				name: 'mypkg',
				main: 'index.js',
				types: 'index.d.ts'
			}),
			'node_modules/mypkg/index.d.ts': `export declare const v: number;`,
			'src/lib/api.ts': `import { v } from 'mypkg';\nexport const out = v;`
		};
		await withTestProject(files, async (projectRoot) => {
			const session = createAnalysisSession({
				sourceOptions: createSourceOptions(projectRoot)
			});
			try {
				const apiId = join(projectRoot, 'src/lib/api.ts');
				await session.setFiles([{ id: apiId, content: files['src/lib/api.ts']! }]);
				assert.deepStrictEqual(session.list(), [apiId]);
				// The package still resolves through the LS disk fallback.
				const query = session.query();
				const out = query.modules[0]?.declarations.find((d) => d.name === 'out');
				assert(out?.kind === 'variable');
				assert.strictEqual(out.typeSignature, 'number');
			} finally {
				session.dispose();
			}
		});
	});

	test('contextClosure: false opts out — the dependency stays unowned', async () => {
		const files: Record<string, string> = {
			'src/lib/internal/helper.ts': `export const width: number = 1;`,
			'src/lib/api.ts': `import { width } from './internal/helper.ts';\nexport const w = width;`
		};
		await withTestProject(files, async (projectRoot) => {
			const session = createAnalysisSession({
				sourceOptions: createSourceOptions(projectRoot),
				contextClosure: false
			});
			try {
				const apiId = join(projectRoot, 'src/lib/api.ts');
				await session.setFiles([{ id: apiId, content: files['src/lib/api.ts']! }]);
				assert.isFalse(session.has(join(projectRoot, 'src/lib/internal/helper.ts')));
				// Type resolution still works via the disk fallback.
				const query = session.query();
				const w = query.modules[0]?.declarations.find((d) => d.name === 'w');
				assert(w?.kind === 'variable');
				assert.strictEqual(w.typeSignature, 'number');
			} finally {
				session.dispose();
			}
		});
	});

	test('a gated Svelte dependency is ingested with its virtual', async () => {
		const files: Record<string, string> = {
			'src/lib/internal/Widget.svelte': `<script lang="ts" module>\n\texport type Size = 'sm' | 'lg';\n</script>\n<div>widget</div>`,
			'src/lib/api.ts': `import type { Size } from './internal/Widget.svelte';\nexport const size: Size = 'sm';`
		};
		await withTestProject(files, async (projectRoot) => {
			const session = createAnalysisSession({
				sourceOptions: createSourceOptions(projectRoot)
			});
			try {
				const apiId = join(projectRoot, 'src/lib/api.ts');
				await session.setFiles([{ id: apiId, content: files['src/lib/api.ts']! }]);
				assert.isTrue(session.has(join(projectRoot, 'src/lib/internal/Widget.svelte')));
				const query = session.query();
				assert.deepStrictEqual(
					query.modules.map((m) => m.path),
					['api.ts']
				);
				const size = query.modules[0]?.declarations.find((d) => d.name === 'size');
				assert(size?.kind === 'variable');
				assert.strictEqual(size.typeSignature, 'Size');
			} finally {
				session.dispose();
			}
		});
	});
});
