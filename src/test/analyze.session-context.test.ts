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
 * stay keyed by the caller's input IDs; a source-scope dependency the caller
 * didn't supply is ingested without emitting a module (which is what types a
 * component through an unsupplied sibling, directly or behind a barrel), and
 * supplying it later promotes it.
 */

import { test, assert, describe } from 'vitest';
import { join } from 'node:path';

import { createAnalysisSession } from '#lib/session.ts';
import { createSourceOptions } from '#lib/source-config.ts';

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

	test('an internal component edit updates the filled re-export alias live', async () => {
		const files: Record<string, string> = {
			'src/lib/internal/Widget.svelte': `<script lang="ts">\n\tlet { label }: { label: string } = $props();\n</script>\n<div>{label}</div>`,
			'src/lib/api.ts': `export { default as Widget } from './internal/Widget.svelte';`
		};
		await withTestProject(files, async (projectRoot) => {
			const session = createAnalysisSession({
				sourceOptions: createSourceOptions(projectRoot)
			});
			try {
				const apiId = join(projectRoot, 'src/lib/api.ts');
				const widgetId = join(projectRoot, 'src/lib/internal/Widget.svelte');
				await session.setFiles([{ id: apiId, content: files['src/lib/api.ts']! }]);

				const before = session.query();
				const widgetBefore = before.modules[0]?.declarations.find((d) => d.name === 'Widget');
				assert(widgetBefore?.kind === 'component');
				assert.deepStrictEqual(
					widgetBefore.props.map((p) => [p.name, p.type]),
					[['label', 'string']]
				);

				// Watcher-style edit on the closure-owned internal component.
				await session.setFile({
					id: widgetId,
					content: `<script lang="ts">\n\tlet { label, count }: { label: string; count: number } = $props();\n</script>\n<div>{label}{count}</div>`
				});

				const after = session.query();
				const widgetAfter = after.modules[0]?.declarations.find((d) => d.name === 'Widget');
				assert(widgetAfter?.kind === 'component');
				assert.deepStrictEqual(
					widgetAfter.props.map((p) => [p.name, p.type]),
					[
						['label', 'string'],
						['count', 'number']
					]
				);
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

	describe('source-scope dependencies', () => {
		const files: Record<string, string> = {
			'src/lib/Button.svelte': `<script lang="ts">\n\tlet { variant }: { variant: 'primary' | 'secondary' } = $props();\n</script>\n<button>{variant}</button>`,
			'src/lib/Modal.svelte': `<script lang="ts">\n\timport type { ComponentProps } from 'svelte';\n\timport Button from './Button.svelte';\n\tlet { confirm }: { confirm: ComponentProps<typeof Button>['variant'] } = $props();\n</script>\n<Button variant={confirm} />`,
			'src/lib/helper.ts': `export type Helper = { a: number };`,
			'src/lib/api.ts': `import type { Helper } from './helper.ts';\nexport const helper: Helper = { a: 1 };`
		};

		const confirmType = (
			modules: ReturnType<ReturnType<typeof createAnalysisSession>['query']>['modules']
		): string | undefined => {
			const modal = modules
				.find((m) => m.path === 'Modal.svelte')
				?.declarations.find((d) => d.name === 'Modal');
			assert(modal?.kind === 'component');
			return modal.props.find((p) => p.name === 'confirm')?.type;
		};

		test('an unsupplied sibling component types its importer and emits no module', async () => {
			await withTestProject(files, async (projectRoot) => {
				const session = createAnalysisSession({
					sourceOptions: createSourceOptions(projectRoot)
				});
				try {
					const modalId = join(projectRoot, 'src/lib/Modal.svelte');
					await session.setFiles([{ id: modalId, content: files['src/lib/Modal.svelte']! }]);
					assert.isTrue(session.has(join(projectRoot, 'src/lib/Button.svelte')));

					const query = session.query();
					assert.deepStrictEqual(
						query.modules.map((m) => m.path),
						['Modal.svelte']
					);
					assert.deepStrictEqual(query.modules[0]?.dependencies, []);
					assert.strictEqual(confirmType(query.modules), '"primary" | "secondary"');
				} finally {
					session.dispose();
				}
			});
		});

		test('contextClosure: false leaves the sibling unowned and its types unresolved', async () => {
			await withTestProject(files, async (projectRoot) => {
				const session = createAnalysisSession({
					sourceOptions: createSourceOptions(projectRoot),
					contextClosure: false
				});
				try {
					const modalId = join(projectRoot, 'src/lib/Modal.svelte');
					await session.setFiles([{ id: modalId, content: files['src/lib/Modal.svelte']! }]);
					assert.isFalse(session.has(join(projectRoot, 'src/lib/Button.svelte')));
					assert.strictEqual(confirmType(session.query().modules), 'any');
				} finally {
					session.dispose();
				}
			});
		});

		test('supplying the sibling later promotes it to an emitted module', async () => {
			await withTestProject(files, async (projectRoot) => {
				const session = createAnalysisSession({
					sourceOptions: createSourceOptions(projectRoot)
				});
				try {
					const modalId = join(projectRoot, 'src/lib/Modal.svelte');
					const buttonId = join(projectRoot, 'src/lib/Button.svelte');
					await session.setFiles([{ id: modalId, content: files['src/lib/Modal.svelte']! }]);

					// Byte-identical content is a cache hit, but the emitted set
					// changes, so the call reports the file changed.
					const promoted = await session.setFile({
						id: buttonId,
						content: files['src/lib/Button.svelte']!
					});
					assert.isTrue(promoted.changed);

					const query = session.query();
					assert.deepStrictEqual(
						query.modules.map((m) => m.path),
						['Button.svelte', 'Modal.svelte']
					);
					assert.deepStrictEqual(
						query.modules.find((m) => m.path === 'Modal.svelte')?.dependencies,
						['Button.svelte']
					);

					// Once promoted, a repeat is an ordinary no-op.
					const repeat = await session.setFile({
						id: buttonId,
						content: files['src/lib/Button.svelte']!
					});
					assert.isFalse(repeat.changed);
				} finally {
					session.dispose();
				}
			});
		});

		test('an edit to the context sibling reaches the importer and promotes it', async () => {
			await withTestProject(files, async (projectRoot) => {
				const session = createAnalysisSession({
					sourceOptions: createSourceOptions(projectRoot)
				});
				try {
					const modalId = join(projectRoot, 'src/lib/Modal.svelte');
					const buttonId = join(projectRoot, 'src/lib/Button.svelte');
					await session.setFiles([{ id: modalId, content: files['src/lib/Modal.svelte']! }]);
					assert.strictEqual(confirmType(session.query().modules), '"primary" | "secondary"');

					await session.setFile({
						id: buttonId,
						content: files['src/lib/Button.svelte']!.replace("'secondary'", "'ghost'")
					});
					const after = session.query();
					assert.strictEqual(confirmType(after.modules), '"primary" | "ghost"');
					// the edit arrives through `setFile`, which supplies the file:
					// the session can't tell a refresh from an input, so it emits
					assert.deepStrictEqual(
						after.modules.map((m) => m.path),
						['Button.svelte', 'Modal.svelte']
					);
				} finally {
					session.dispose();
				}
			});
		});

		test('re-exports of a context component document where they are re-exported', async () => {
			const reExportFiles: Record<string, string> = {
				'src/lib/Widget.svelte': `<script lang="ts" module>\n\texport type A = 'a' | 'b';\n\texport const fn = (x: A): A => x;\n</script>\n\n<script lang="ts">\n\tlet { a }: { a: A } = $props();\n</script>\n\n{a}`,
				'src/lib/index.ts': `export { fn, type A } from './Widget.svelte';\nexport { default as Widget } from './Widget.svelte';`
			};
			await withTestProject(reExportFiles, async (projectRoot) => {
				const session = createAnalysisSession({
					sourceOptions: createSourceOptions(projectRoot)
				});
				try {
					const indexId = join(projectRoot, 'src/lib/index.ts');
					await session.setFiles([{ id: indexId, content: reExportFiles['src/lib/index.ts']! }]);
					const { modules, diagnostics } = session.query();
					assert.deepStrictEqual(diagnostics, []);
					assert.deepStrictEqual(
						modules.map((m) => m.path),
						['index.ts']
					);
					// the canonical emits nothing, so there is no module to link to:
					// each name is a full declaration here, not a `reExports` edge
					const index = modules[0]!;
					assert.deepStrictEqual(index.reExports, []);
					assert.deepStrictEqual(
						index.declarations.map((d) => [d.name, d.kind, d.aliasOf?.name]),
						[
							['fn', 'function', 'fn'],
							['A', 'type', 'A'],
							['Widget', 'component', 'Widget']
						]
					);
					const widget = index.declarations[2]!;
					assert(widget.kind === 'component');
					assert.deepStrictEqual(
						widget.props.map((p) => [p.name, p.type]),
						[['a', 'A']]
					);
				} finally {
					session.dispose();
				}
			});
		});

		test('a context component that fails to transform reports it', async () => {
			const brokenFiles: Record<string, string> = {
				// an `{#each}` with no expression is one of the few inputs svelte2tsx rejects
				'src/lib/Broken.svelte': `{#each}`,
				'src/lib/api.ts': `import type Broken from './Broken.svelte';\nexport const a: typeof Broken | null = null;`
			};
			await withTestProject(brokenFiles, async (projectRoot) => {
				const session = createAnalysisSession({
					sourceOptions: createSourceOptions(projectRoot)
				});
				try {
					const apiId = join(projectRoot, 'src/lib/api.ts');
					const result = await session.setFiles([
						{ id: apiId, content: brokenFiles['src/lib/api.ts']! }
					]);
					// like any context file's, the diagnostic is on the cumulative
					// view, not the batch return, and the file emits no placeholder
					assert.deepStrictEqual(result.diagnostics, []);
					assert.deepStrictEqual(
						session.allIngestDiagnostics().map((d) => [d.kind, d.file]),
						[['transform_failed', 'src/lib/Broken.svelte']]
					);
					assert.deepStrictEqual(
						session.query().modules.map((m) => m.path),
						['api.ts']
					);
				} finally {
					session.dispose();
				}
			});
		});

		test('a source-scope TS dependency is context: owned, live, and not emitted', async () => {
			await withTestProject(files, async (projectRoot) => {
				const session = createAnalysisSession({
					sourceOptions: createSourceOptions(projectRoot)
				});
				try {
					const apiId = join(projectRoot, 'src/lib/api.ts');
					const helperId = join(projectRoot, 'src/lib/helper.ts');
					await session.setFiles([{ id: apiId, content: files['src/lib/api.ts']! }]);
					assert.isTrue(session.has(helperId));
					const query = session.query();
					assert.deepStrictEqual(
						query.modules.map((m) => m.path),
						['api.ts']
					);
					assert.deepStrictEqual(query.modules[0]?.dependencies, []);
					const helper = query.modules[0]?.declarations.find((d) => d.name === 'helper');
					assert(helper?.kind === 'variable');
					assert.strictEqual(helper.typeSignature, 'Helper');
				} finally {
					session.dispose();
				}
			});
		});

		test('a component behind an unsupplied TS barrel types its importer', async () => {
			const barrelFiles: Record<string, string> = {
				'src/lib/Button.svelte': files['src/lib/Button.svelte']!,
				'src/lib/components.ts': `export { default as Button } from './Button.svelte';`,
				'src/lib/Modal.svelte': files['src/lib/Modal.svelte']!.replace(
					`import Button from './Button.svelte';`,
					`import { Button } from './components.ts';`
				)
			};
			await withTestProject(barrelFiles, async (projectRoot) => {
				const session = createAnalysisSession({
					sourceOptions: createSourceOptions(projectRoot)
				});
				try {
					const modalId = join(projectRoot, 'src/lib/Modal.svelte');
					await session.setFiles([{ id: modalId, content: barrelFiles['src/lib/Modal.svelte']! }]);
					assert.isTrue(session.has(join(projectRoot, 'src/lib/components.ts')));
					assert.isTrue(session.has(join(projectRoot, 'src/lib/Button.svelte')));
					const query = session.query();
					assert.deepStrictEqual(
						query.modules.map((m) => m.path),
						['Modal.svelte']
					);
					assert.strictEqual(confirmType(query.modules), '"primary" | "secondary"');
				} finally {
					session.dispose();
				}
			});
		});
	});
});
