/**
 * Tests for the module-level `reExports` field — the forward view of
 * `alsoExportedFrom` published by `analyzeExports`
 * (`src/lib/typescript-exports.ts`) and merged in `mergeReExports`
 * (`src/lib/postprocess.ts`). Covers forward/back-link agreement,
 * JSDoc/`@nodocs` handling, star-projection silence (`starExports` as the
 * sole encoding), default-slot re-keying, sorting/dedupe, and
 * external-package re-exports (`externalReExports`/`externalStarExports`).
 */

import { test, assert, describe } from 'vitest';
import { join } from 'node:path';

import { analyze } from '$lib/analyze.ts';
import type { SourceFileInfo } from '$lib/source.ts';
import { createSourceOptions } from '$lib/source-config.ts';

import { withTestProject } from './test-helpers.ts';

const createSourceFiles = (
	projectRoot: string,
	files: Record<string, string>
): Array<SourceFileInfo> => {
	return Object.entries(files)
		.filter(
			([path]) =>
				path.endsWith('.ts') ||
				path.endsWith('.svelte') ||
				path.endsWith('.css') ||
				path.endsWith('.json')
		)
		.map(([path, content]) => ({
			id: join(projectRoot, path),
			content
		}));
};

const setupAnalysis = (projectRoot: string, files: Record<string, string>) => {
	const sourceFiles = createSourceFiles(projectRoot, files);
	const sourceOptions = createSourceOptions(projectRoot);
	return { sourceFiles, sourceOptions };
};

describe('module-level reExports field', { timeout: 15_000 }, () => {
	test('same-name re-export publishes a forward edge; rename synthesizes an alias instead', async () => {
		const files = {
			'src/lib/a.ts': `export const foo = 1;\nexport const bar = 2;\n`,
			'src/lib/index.ts': `export {foo} from './a.js';\nexport {bar as baz} from './a.js';\n`
		};

		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules } = await analyze({ sourceFiles, sourceOptions });

			const indexModule = modules.find((m) => m.path === 'index.ts')!;
			assert.deepStrictEqual(indexModule.reExports, [
				{ name: 'foo', module: 'a.ts', typeOnly: false, sourceLine: 1 }
			]);

			// The rename is a declaration with aliasOf, not a reExports entry —
			// its sourceLine is the local specifier's line
			const baz = indexModule.declarations.find((d) => d.name === 'baz');
			assert.ok(baz);
			assert.deepStrictEqual(baz.aliasOf, { module: 'a.ts', name: 'bar' });
			assert.strictEqual(baz.sourceLine, 2);

			// Forward edge matches the back-link on the canonical
			const foo = modules
				.find((m) => m.path === 'a.ts')!
				.declarations.find((d) => d.name === 'foo');
			assert.deepStrictEqual(foo?.alsoExportedFrom, ['index.ts']);
		});
	});

	test('forward edges point at the canonical module across multi-hop chains', async () => {
		const files = {
			'src/lib/a.ts': `export const foo = 1;\n`,
			'src/lib/b.ts': `export {foo} from './a.js';\n`,
			'src/lib/c.ts': `export {foo} from './b.js';\n`
		};

		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules } = await analyze({ sourceFiles, sourceOptions });

			// Both hops resolve to a.ts, not the immediate specifier
			const b = modules.find((m) => m.path === 'b.ts')!;
			const c = modules.find((m) => m.path === 'c.ts')!;
			assert.deepStrictEqual(b.reExports, [
				{ name: 'foo', module: 'a.ts', typeOnly: false, sourceLine: 1 }
			]);
			assert.deepStrictEqual(c.reExports, [
				{ name: 'foo', module: 'a.ts', typeOnly: false, sourceLine: 1 }
			]);
		});
	});

	test('@nodocs on the export statement suppresses the forward edge', async () => {
		const files = {
			'src/lib/a.ts': `export const foo = 1;\n`,
			'src/lib/index.ts': `/** @nodocs */\nexport {foo} from './a.js';\n`
		};

		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules } = await analyze({ sourceFiles, sourceOptions });

			const indexModule = modules.find((m) => m.path === 'index.ts')!;
			assert.deepStrictEqual(indexModule.reExports, []);
		});
	});

	test('module comment (with @nodocs) on the first statement does not suppress its edges', async () => {
		// The AST attaches a file's module comment to the first statement —
		// it must not read as that statement's local JSDoc (which would
		// synthesize a Position-3 alias and, via @nodocs, suppress the edges)
		const files = {
			'src/lib/a.ts': `export const foo = 1;\nexport type Bar = number;\n`,
			'src/lib/index.ts': `/**\n * Barrel docs.\n *\n * @module\n * @nodocs\n */\n\nexport {foo} from './a.js';\nexport type {Bar} from './a.js';\n`,
			'src/lib/star.ts': `/**\n * Star barrel.\n *\n * @module\n * @nodocs\n */\n\nexport * from './a.js';\n`
		};

		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules, diagnostics } = await analyze({ sourceFiles, sourceOptions });

			const indexModule = modules.find((m) => m.path === 'index.ts')!;
			assert.ok(indexModule.moduleComment, 'module comment still extracted');
			assert.deepStrictEqual(indexModule.reExports, [
				{ name: 'Bar', module: 'a.ts', typeOnly: true, sourceLine: 9 },
				{ name: 'foo', module: 'a.ts', typeOnly: false, sourceLine: 8 }
			]);
			// no Position-3 alias synthesized from the module comment
			assert.deepStrictEqual(indexModule.declarations, []);

			// back-link agrees with the forward edge
			const foo = modules
				.find((m) => m.path === 'a.ts')!
				.declarations.find((d) => d.name === 'foo');
			assert.deepStrictEqual(foo?.alsoExportedFrom, ['index.ts']);

			// star export as first statement survives too
			const starModule = modules.find((m) => m.path === 'star.ts')!;
			assert.deepStrictEqual(starModule.starExports, ['a.ts']);

			// the inert module-level @nodocs is surfaced as a warning per module
			const misplaced = diagnostics.filter((d) => d.kind === 'misplaced_tag');
			assert.deepStrictEqual(misplaced.map((d) => d.file).sort(), [
				'src/lib/index.ts',
				'src/lib/star.ts'
			]);
		});
	});

	test('same-name with JSDoc (Position 3) keeps both the alias declaration and the forward edge', async () => {
		const files = {
			'src/lib/a.ts': `export const foo = 1;\n`,
			'src/lib/index.ts': `/** Local view of foo. */\nexport {foo} from './a.js';\n`
		};

		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules, diagnostics } = await analyze({ sourceFiles, sourceOptions });

			const indexModule = modules.find((m) => m.path === 'index.ts')!;
			assert.deepStrictEqual(indexModule.reExports, [
				{ name: 'foo', module: 'a.ts', typeOnly: false, sourceLine: 2 }
			]);
			const alias = indexModule.declarations.find((d) => d.name === 'foo');
			assert.ok(alias, 'local JSDoc should synthesize an alias declaration');
			assert.strictEqual(alias.docComment, 'Local view of foo.');
			assert.strictEqual(alias.sourceLine, 2);
			// The synthesized alias is the same thing as the canonical — not a
			// flat-namespace collision (findDuplicates resolves aliasOf)
			assert.ok(!diagnostics.some((d) => d.kind === 'duplicate_declaration'));
		});
	});

	test('re-exporting a component under its own name is not a duplicate of the canonical', async () => {
		// `export {default as Foo} from './Foo.svelte'` synthesizes an alias
		// named `Foo` — the same public name as the filename-derived canonical.
		// findDuplicates resolves the aliasOf chain, so the standard component
		// barrel pattern doesn't flag (and doesn't throw under
		// `onDuplicates: 'throw'`).
		const files = {
			'src/lib/Foo.svelte': `<script lang="ts">
let {label}: {label: string} = $props();
</script>
<button>{label}</button>`,
			'src/lib/index.ts': `export {default as Foo} from './Foo.svelte';\n`
		};

		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules, diagnostics } = await analyze({ sourceFiles, sourceOptions });

			const alias = modules
				.find((m) => m.path === 'index.ts')!
				.declarations.find((d) => d.name === 'Foo');
			assert.deepStrictEqual(alias?.aliasOf, { module: 'Foo.svelte', name: 'Foo' });
			assert.ok(!diagnostics.some((d) => d.kind === 'duplicate_declaration'));
		});
	});

	test('star exports stay in starExports; reExports stays empty', async () => {
		const files = {
			'src/lib/a.ts': `export const foo = 1;\n`,
			'src/lib/index.ts': `export * from './a.js';\n`
		};

		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules, diagnostics } = await analyze({ sourceFiles, sourceOptions });

			const indexModule = modules.find((m) => m.path === 'index.ts')!;
			assert.deepStrictEqual(indexModule.starExports, ['a.ts']);
			assert.deepStrictEqual(indexModule.reExports, []);
			// Star projection synthesizes no declarations in the projecting module
			// (and so no spurious duplicate_declaration diagnostics either)
			assert.deepStrictEqual(indexModule.declarations, []);
			assert.ok(!diagnostics.some((d) => d.kind === 'duplicate_declaration'));
			// ...and no alsoExportedFrom back-link on the canonical — `starExports`
			// is the sole encoding for star re-exports
			const foo = modules
				.find((m) => m.path === 'a.ts')!
				.declarations.find((d) => d.name === 'foo');
			assert.deepStrictEqual(foo?.alsoExportedFrom, []);
		});
	});

	test('@nodocs on a star export suppresses the starExports entry', async () => {
		// Statement-level `@nodocs` works on all three re-export encodings;
		// plain JSDoc (no `@nodocs`) leaves the entry alone — there is no
		// Position-3 synthesis for stars.
		const files = {
			'src/lib/a.ts': `export const foo = 1;\n`,
			'src/lib/b.ts': `export const bar = 2;\n`,
			'src/lib/index.ts': `/** @nodocs */\nexport * from './a.js';\n/** Documented star. */\nexport * from './b.js';\n`
		};

		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules } = await analyze({ sourceFiles, sourceOptions });

			const indexModule = modules.find((m) => m.path === 'index.ts')!;
			assert.deepStrictEqual(indexModule.starExports, ['b.ts']);
		});
	});

	test('star-projected re-export aliases are not materialized either (no edges, no declarations)', async () => {
		// `export * from './b.js'` projects b.ts's own re-export specifiers
		// (alias-flagged, foreign ExportSpecifier symbol) into index.ts's export
		// table. Like star-projected value symbols, `starExports` is their sole
		// encoding — no forward edge, no back-link, no duplicate_declaration.
		const files = {
			'src/lib/a.ts': `export const foo = 1;\n`,
			'src/lib/b.ts': `export {foo} from './a.js';\n`,
			'src/lib/index.ts': `export * from './b.js';\n`
		};

		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules, diagnostics } = await analyze({ sourceFiles, sourceOptions });

			const indexModule = modules.find((m) => m.path === 'index.ts')!;
			assert.deepStrictEqual(indexModule.starExports, ['b.ts']);
			assert.deepStrictEqual(indexModule.reExports, []);
			assert.deepStrictEqual(indexModule.declarations, []);
			assert.ok(!diagnostics.some((d) => d.kind === 'duplicate_declaration'));

			// b.ts keeps its own forward edge; the canonical's back-links cover
			// only the module whose source contains the statement
			const bModule = modules.find((m) => m.path === 'b.ts')!;
			assert.deepStrictEqual(bModule.reExports, [
				{ name: 'foo', module: 'a.ts', typeOnly: false, sourceLine: 1 }
			]);
			const foo = modules
				.find((m) => m.path === 'a.ts')!
				.declarations.find((d) => d.name === 'foo');
			assert.deepStrictEqual(foo?.alsoExportedFrom, ['b.ts']);
		});
	});

	test('star-projected renamed re-export specifiers are not materialized', async () => {
		// b.ts's rename synthesizes an aliasOf declaration in b.ts only. The
		// star-projecting module shares the foreign ExportSpecifier symbol —
		// without the locality skip it would synthesize a duplicate `bar`
		// alias there (the renamed branch synthesizes unconditionally, unlike
		// the same-name branch which requires local JSDoc).
		const files = {
			'src/lib/a.ts': `export const foo = 1;\n`,
			'src/lib/b.ts': `export {foo as bar} from './a.js';\n`,
			'src/lib/index.ts': `export * from './b.js';\n`
		};

		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules, diagnostics } = await analyze({ sourceFiles, sourceOptions });

			const indexModule = modules.find((m) => m.path === 'index.ts')!;
			assert.deepStrictEqual(indexModule.declarations, []);
			assert.deepStrictEqual(indexModule.reExports, []);
			assert.ok(!diagnostics.some((d) => d.kind === 'duplicate_declaration'));

			const bar = modules
				.find((m) => m.path === 'b.ts')!
				.declarations.find((d) => d.name === 'bar');
			assert.deepStrictEqual(bar?.aliasOf, { module: 'a.ts', name: 'foo' });
		});
	});

	test('canonical @nodocs: the forward edge persists without a back-link target', async () => {
		// `@nodocs` on the canonical declaration removes it from output, but
		// the re-exporting module's source still contains the statement — the
		// forward entry stays, with no matching declaration to back-link (the
		// documented presence caveat shared with `aliasOf.module`).
		const files = {
			'src/lib/a.ts': `/** @nodocs */\nexport const foo = 1;\n`,
			'src/lib/index.ts': `export {foo} from './a.js';\n`
		};

		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules } = await analyze({ sourceFiles, sourceOptions });

			const indexModule = modules.find((m) => m.path === 'index.ts')!;
			assert.deepStrictEqual(indexModule.reExports, [
				{ name: 'foo', module: 'a.ts', typeOnly: false, sourceLine: 1 }
			]);
			const aModule = modules.find((m) => m.path === 'a.ts')!;
			assert.deepStrictEqual(aModule.declarations, []);
		});
	});

	test('foreign JSDoc on a star-projected re-export statement does not leak across the star', async () => {
		// b.ts's documented re-export statement triggers Position-3 synthesis in
		// b.ts only. The star-projecting module shares b.ts's ExportSpecifier
		// symbol, so without the locality skip the foreign JSDoc would
		// synthesize a duplicate declaration in index.ts with b.ts's docs.
		const files = {
			'src/lib/a.ts': `export const foo = 1;\n`,
			'src/lib/b.ts': `/** B's local view. */\nexport {foo} from './a.js';\n`,
			'src/lib/index.ts': `export * from './b.js';\n`
		};

		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules } = await analyze({ sourceFiles, sourceOptions });

			const indexModule = modules.find((m) => m.path === 'index.ts')!;
			assert.deepStrictEqual(indexModule.declarations, []);
			assert.deepStrictEqual(indexModule.reExports, []);

			// Position 3 stays where the statement lives
			const bAlias = modules
				.find((m) => m.path === 'b.ts')!
				.declarations.find((d) => d.name === 'foo');
			assert.strictEqual(bAlias?.docComment, "B's local view.");
			// ...and the canonical's back-link covers b.ts only
			const foo = modules
				.find((m) => m.path === 'a.ts')!
				.declarations.find((d) => d.name === 'foo');
			assert.deepStrictEqual(foo?.alsoExportedFrom, ['b.ts']);
		});
	});

	test('Svelte default-slot re-export re-keys the edge by component name', async () => {
		const files = {
			'src/lib/Foo.svelte': `<script lang="ts">
let {label}: {label: string} = $props();
</script>
<button>{label}</button>`,
			'src/lib/index.ts': `export {default} from './Foo.svelte';\n`
		};

		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules } = await analyze({ sourceFiles, sourceOptions });

			const indexModule = modules.find((m) => m.path === 'index.ts')!;
			assert.deepStrictEqual(indexModule.reExports, [
				{ name: 'Foo', module: 'Foo.svelte', typeOnly: false, sourceLine: 1 }
			]);
		});
	});

	test("non-Svelte default-slot re-export keys the edge by name 'default'", async () => {
		const files = {
			'src/lib/a.ts': `export default function foo(): void {}\n`,
			'src/lib/b.ts': `export {default} from './a.js';\n`
		};

		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules } = await analyze({ sourceFiles, sourceOptions });

			const bModule = modules.find((m) => m.path === 'b.ts')!;
			assert.deepStrictEqual(bModule.reExports, [
				{ name: 'default', module: 'a.ts', typeOnly: false, sourceLine: 1 }
			]);
		});
	});

	test('entries are sorted by name regardless of source order', async () => {
		const files = {
			'src/lib/a.ts': `export const zeta = 1;\nexport const alpha = 2;\nexport const mid = 3;\n`,
			'src/lib/index.ts': `export {zeta} from './a.js';\nexport {alpha} from './a.js';\nexport {mid} from './a.js';\n`
		};

		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules } = await analyze({ sourceFiles, sourceOptions });

			const indexModule = modules.find((m) => m.path === 'index.ts')!;
			assert.deepStrictEqual(
				indexModule.reExports.map((r) => r.name),
				['alpha', 'mid', 'zeta']
			);
		});
	});

	test('namespace same-name re-export records an edge at the namespace-defining module', async () => {
		const files = {
			'src/lib/x.ts': `export const a = 1;`,
			'src/lib/index.ts': `export * as ns from './x.js';`,
			'src/lib/barrel.ts': `export {ns} from './index.js';`
		};

		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules } = await analyze({ sourceFiles, sourceOptions });

			const barrel = modules.find((m) => m.path === 'barrel.ts')!;
			assert.deepStrictEqual(barrel.reExports, [
				{ name: 'ns', module: 'index.ts', typeOnly: false, sourceLine: 1 }
			]);
			// The origination itself is a declaration, not a forward edge
			const indexModule = modules.find((m) => m.path === 'index.ts')!;
			assert.deepStrictEqual(indexModule.reExports, []);
		});
	});

	test('Svelte <script module> re-exports publish forward edges on the .svelte module', async () => {
		const files = {
			'src/lib/helpers.ts': `export const helper = (): void => {};\n`,
			'src/lib/Foo.svelte': `<script module lang="ts">
export {helper} from './helpers.js';
</script>
<p>text</p>`
		};

		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules } = await analyze({ sourceFiles, sourceOptions });

			const svelteModule = modules.find((m) => m.path === 'Foo.svelte')!;
			assert.deepStrictEqual(svelteModule.reExports, [
				// sourceLine remapped to the original .svelte source via source map
				{ name: 'helper', module: 'helpers.ts', typeOnly: false, sourceLine: 2 }
			]);
			const helper = modules
				.find((m) => m.path === 'helpers.ts')!
				.declarations.find((d) => d.name === 'helper');
			assert.deepStrictEqual(helper?.alsoExportedFrom, ['Foo.svelte']);
		});
	});

	test('type-only re-export publishes a forward edge like a value re-export', async () => {
		const files = {
			'src/lib/a.ts': `export interface A {\n\ta: number;\n}\n`,
			'src/lib/index.ts': `export type {A} from './a.js';\n`
		};

		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules } = await analyze({ sourceFiles, sourceOptions });

			const indexModule = modules.find((m) => m.path === 'index.ts')!;
			assert.deepStrictEqual(indexModule.reExports, [
				{ name: 'A', module: 'a.ts', typeOnly: true, sourceLine: 1 }
			]);
			const canonical = modules
				.find((m) => m.path === 'a.ts')!
				.declarations.find((d) => d.name === 'A');
			assert.deepStrictEqual(canonical?.alsoExportedFrom, ['index.ts']);
		});
	});

	test('colliding names (Svelte default re-key + same-name from another module) tie-break by module', async () => {
		// `export {default} from './Foo.svelte'` re-keys to 'Foo'; a same-name
		// re-export of an unrelated `Foo` from another module shares the name.
		// `(module, name)` stays unique; sort is deterministic via module tie-break.
		const files = {
			'src/lib/Foo.svelte': `<script lang="ts">
let {label}: {label: string} = $props();
</script>
<button>{label}</button>`,
			'src/lib/other.ts': `export const Foo = 1;\n`,
			'src/lib/barrel.ts': `export {default} from './Foo.svelte';\nexport {Foo} from './other.js';\n`
		};

		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules, diagnostics } = await analyze({ sourceFiles, sourceOptions });

			const barrel = modules.find((m) => m.path === 'barrel.ts')!;
			assert.deepStrictEqual(barrel.reExports, [
				{ name: 'Foo', module: 'Foo.svelte', typeOnly: false, sourceLine: 1 },
				{ name: 'Foo', module: 'other.ts', typeOnly: false, sourceLine: 2 }
			]);

			// Each canonical gets its own back-link
			const component = modules
				.find((m) => m.path === 'Foo.svelte')!
				.declarations.find((d) => d.name === 'Foo');
			assert.deepStrictEqual(component?.alsoExportedFrom, ['barrel.ts']);
			const constant = modules
				.find((m) => m.path === 'other.ts')!
				.declarations.find((d) => d.name === 'Foo');
			assert.deepStrictEqual(constant?.alsoExportedFrom, ['barrel.ts']);

			// The two canonicals are a flat-namespace duplicate — orthogonal to reExports
			assert.ok(diagnostics.some((d) => d.kind === 'duplicate_declaration'));
		});
	});

	test('exact-duplicate edges are deduped (Svelte default re-key + same-name script-module export)', async () => {
		// `export {default} from './Foo.svelte'` re-keys to 'Foo'; the same
		// file's `<script module>` also exports a const `Foo`, so re-exporting
		// both produces two identical `{name: 'Foo', module: 'Foo.svelte'}`
		// edges. Deduped so `(name, module)` pairs stay unique.
		const files = {
			'src/lib/Foo.svelte': `<script module lang="ts">
export const Foo = 1;
</script>
<p>text</p>`,
			'src/lib/barrel.ts': `export {default} from './Foo.svelte';\nexport {Foo} from './Foo.svelte';\n`
		};

		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules } = await analyze({ sourceFiles, sourceOptions });

			const barrel = modules.find((m) => m.path === 'barrel.ts')!;
			// the deduped pair keeps the smallest sourceLine
			assert.deepStrictEqual(barrel.reExports, [
				{ name: 'Foo', module: 'Foo.svelte', typeOnly: false, sourceLine: 1 }
			]);
		});
	});

	test('re-export from an external package lands in externalReExports (no declaration, no edge)', async () => {
		const files = {
			'node_modules/extpkg/package.json': `{"name": "extpkg", "version": "1.0.0", "main": "./index.js", "types": "./index.d.ts"}`,
			'node_modules/extpkg/index.d.ts': `export declare const ext: number;\nexport declare const ext2: number;\n`,
			'node_modules/extpkg/index.js': `export const ext = 1;\nexport const ext2 = 2;\n`,
			'src/lib/index.ts': `export {ext} from 'extpkg';\nexport {ext2 as renamedExt} from 'extpkg';\nexport const local = 1;\n`
		};

		await withTestProject(files, async (projectRoot) => {
			// Build sourceFiles by hand — only src/lib belongs to the analysis
			// input; node_modules files exist on disk for module resolution.
			const sourceFiles = [
				{
					id: join(projectRoot, 'src/lib/index.ts'),
					content: files['src/lib/index.ts']
				}
			];
			const sourceOptions = createSourceOptions(projectRoot);
			const { modules } = await analyze({ sourceFiles, sourceOptions });

			const indexModule = modules.find((m) => m.path === 'index.ts')!;
			assert.deepStrictEqual(indexModule.reExports, []);
			assert.deepStrictEqual(
				indexModule.declarations.map((d) => d.name),
				['local']
			);
			assert.deepStrictEqual(indexModule.externalReExports, [
				{ name: 'ext', specifier: 'extpkg', typeOnly: false, sourceLine: 1 },
				{
					name: 'renamedExt',
					specifier: 'extpkg',
					originalName: 'ext2',
					typeOnly: false,
					sourceLine: 2
				}
			]);
		});
	});

	test('external namespace, star, and type-only re-exports are captured; @nodocs suppresses', async () => {
		const files = {
			'node_modules/extpkg/package.json': `{"name": "extpkg", "version": "1.0.0", "main": "./index.js", "types": "./index.d.ts"}`,
			'node_modules/extpkg/index.d.ts': `export declare const ext: number;\nexport interface ExtConfig {\n\ta: number;\n}\n`,
			'node_modules/extpkg/index.js': `export const ext = 1;\n`,
			'src/lib/index.ts': `export * as extns from 'extpkg';\nexport type {ExtConfig} from 'extpkg';\nexport * from 'extpkg';\n/** @nodocs */\nexport {ext as hidden} from 'extpkg';\n`
		};

		await withTestProject(files, async (projectRoot) => {
			const sourceFiles = [
				{
					id: join(projectRoot, 'src/lib/index.ts'),
					content: files['src/lib/index.ts']
				}
			];
			const sourceOptions = createSourceOptions(projectRoot);
			const { modules } = await analyze({ sourceFiles, sourceOptions });

			const indexModule = modules.find((m) => m.path === 'index.ts')!;
			assert.deepStrictEqual(indexModule.externalReExports, [
				{ name: 'ExtConfig', specifier: 'extpkg', typeOnly: true, sourceLine: 2 },
				{ name: 'extns', specifier: 'extpkg', typeOnly: false, sourceLine: 1 }
			]);
			assert.deepStrictEqual(indexModule.externalStarExports, ['extpkg']);
			assert.deepStrictEqual(indexModule.starExports, []);
			// no declarations synthesized for any of these
			assert.deepStrictEqual(indexModule.declarations, []);
		});
	});

	test('import-then-export and chains through a source module stay out of externalReExports', async () => {
		// `import {x}; export {x}` has no re-export statement — the specifier
		// lives on the import. And a re-export of a source module that itself
		// re-exports the package is owned by that module, not this one.
		const files = {
			'node_modules/extpkg/package.json': `{"name": "extpkg", "version": "1.0.0", "main": "./index.js", "types": "./index.d.ts"}`,
			'node_modules/extpkg/index.d.ts': `export declare const ext: number;\n`,
			'node_modules/extpkg/index.js': `export const ext = 1;\n`,
			'src/lib/touches.ts': `export {ext} from 'extpkg';\n`,
			'src/lib/index.ts': `import {ext} from 'extpkg';\nexport {ext};\nexport {ext as chained} from './touches.js';\n`
		};

		await withTestProject(files, async (projectRoot) => {
			const sourceFiles = [
				{ id: join(projectRoot, 'src/lib/touches.ts'), content: files['src/lib/touches.ts'] },
				{ id: join(projectRoot, 'src/lib/index.ts'), content: files['src/lib/index.ts'] }
			];
			const sourceOptions = createSourceOptions(projectRoot);
			const { modules } = await analyze({ sourceFiles, sourceOptions });

			const indexModule = modules.find((m) => m.path === 'index.ts')!;
			assert.deepStrictEqual(indexModule.externalReExports, []);
			const touches = modules.find((m) => m.path === 'touches.ts')!;
			assert.deepStrictEqual(touches.externalReExports, [
				{ name: 'ext', specifier: 'extpkg', typeOnly: false, sourceLine: 1 }
			]);
		});
	});

	test('inline type-only specifier (export {type A}) marks the source edge', async () => {
		const files = {
			'src/lib/a.ts': `export interface A {\n\ta: number;\n}\nexport const b = 1;\n`,
			'src/lib/index.ts': `export {type A, b} from './a.js';\n`
		};

		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules } = await analyze({ sourceFiles, sourceOptions });

			const indexModule = modules.find((m) => m.path === 'index.ts')!;
			assert.deepStrictEqual(indexModule.reExports, [
				{ name: 'A', module: 'a.ts', typeOnly: true, sourceLine: 1 },
				{ name: 'b', module: 'a.ts', typeOnly: false, sourceLine: 1 }
			]);
		});
	});
});
