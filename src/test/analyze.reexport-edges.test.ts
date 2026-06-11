/**
 * Tests for re-export edge cases adjacent to the cross-file renamed-re-export
 * fix in `analyzeExports` (`src/lib/typescript-exports.ts`).
 *
 * **Multi-hop chains** — all topologies covered (same-name N-hop,
 * rename-then-rename, rename-then-same-name, same-name-then-rename, deep).
 * **Svelte component re-exports** — covered by the phase-2 fixup in
 * `mergeReExports` (`src/lib/postprocess.ts`) that copies fields from the
 * canonical component declaration onto component-aliased synthesized
 * declarations.
 * **JSDoc on re-export statements** — Position-3 alias synthesis for local
 * JSDoc, `@nodocs` suppression, and default-slot (`name === 'default'`)
 * handling.
 *
 * Namespace re-exports and the module-level `reExports` forward view live in
 * the sibling `analyze.reexport-*.test.ts` files.
 */

import {test, assert, describe} from 'vitest';
import {join} from 'node:path';

import {analyze} from '$lib/analyze.js';
import {findDuplicates} from '$lib/postprocess.js';
import type {SourceFileInfo} from '$lib/source.js';
import {createSourceOptions} from '$lib/source-config.js';

import {withTestProject} from './test-helpers.js';

const createSourceFiles = (
	projectRoot: string,
	files: Record<string, string>,
): Array<SourceFileInfo> => {
	return Object.entries(files)
		.filter(
			([path]) =>
				path.endsWith('.ts') ||
				path.endsWith('.svelte') ||
				path.endsWith('.css') ||
				path.endsWith('.json'),
		)
		.map(([path, content]) => ({
			id: join(projectRoot, path),
			content,
		}));
};

const setupAnalysis = (projectRoot: string, files: Record<string, string>) => {
	const sourceFiles = createSourceFiles(projectRoot, files);
	const sourceOptions = createSourceOptions(projectRoot);
	return {sourceFiles, sourceOptions};
};

describe('renamed Svelte component re-exports', {timeout: 15_000}, () => {
	test('export {default as Renamed} synthesizes a component-shaped alias with canonical fields propagated', async () => {
		const files = {
			'src/lib/Foo.svelte': `<script lang="ts">
/** Foo's docs. */
let {label, count = 0}: {label: string; count?: number} = $props();
</script>
<button>{label} {count}</button>
{@render children?.()}`,
			'src/lib/index.ts': `export {default as Renamed} from './Foo.svelte';`,
		};

		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});

			const indexModule = modules.find((m) => m.path === 'index.ts');
			assert.ok(indexModule);
			const renamed = indexModule.declarations.find((d) => d.name === 'Renamed');
			assert.ok(renamed, 'Should find Renamed declaration');

			assert.strictEqual(renamed.kind, 'component');
			assert.ok(renamed.aliasOf);
			assert.strictEqual(renamed.aliasOf.module, 'Foo.svelte');
			assert.strictEqual(renamed.aliasOf.name, 'Foo');
			// Synthesized alias points at the local export specifier's line
			assert.strictEqual(renamed.sourceLine, 1);

			// Component-specific fields propagated from the canonical
			assert.strictEqual(renamed.kind, 'component');
			if (renamed.kind === 'component') {
				assert.deepStrictEqual(renamed.props.map((p) => p.name).sort(), ['count', 'label']);
				assert.strictEqual(renamed.acceptsChildren, true);
				// TS component → lang remains undefined (only set for JS-only components)
				assert.strictEqual(renamed.lang, undefined);
			}

			// Canonical component picks up alsoExportedFrom for the renamed alias too
			const fooComponent = modules
				.find((m) => m.path === 'Foo.svelte')
				?.declarations.find((d) => d.name === 'Foo');
			assert.ok(fooComponent);
			// Renamed re-exports don't add to alsoExportedFrom (that's same-name only)
			assert.deepStrictEqual(fooComponent.alsoExportedFrom, []);
		});
	});

	test('export {default} adds the re-exporting module to alsoExportedFrom on the canonical', async () => {
		const files = {
			'src/lib/Foo.svelte': `<script lang="ts">
let {label}: {label: string} = $props();
</script>
<button>{label}</button>`,
			'src/lib/index.ts': `export {default} from './Foo.svelte';`,
		};

		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});

			const fooModule = modules.find((m) => m.path === 'Foo.svelte');
			assert.ok(fooModule);
			const fooComponent = fooModule.declarations.find((d) => d.name === 'Foo');
			assert.ok(fooComponent);
			assert.deepStrictEqual(fooComponent.alsoExportedFrom, ['index.ts']);

			// index.ts does not carry a phantom 'default' declaration
			const indexModule = modules.find((m) => m.path === 'index.ts');
			assert.strictEqual(
				indexModule?.declarations.find((d) => d.name === 'default'),
				undefined,
			);
		});
	});

	test('JS-only component re-export propagates lang: js through the alias', async () => {
		const files = {
			'src/lib/Foo.svelte': `<script>
let {label} = $props();
</script>
<button>{label}</button>`,
			'src/lib/index.ts': `export {default as Renamed} from './Foo.svelte';`,
		};

		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});

			const renamed = modules
				.find((m) => m.path === 'index.ts')
				?.declarations.find((d) => d.name === 'Renamed');
			assert.ok(renamed);
			assert.strictEqual(renamed.kind, 'component');
			if (renamed.kind === 'component') {
				assert.strictEqual(renamed.lang, 'js');
			}

			// Canonical also reports lang: 'js'
			const canonical = modules
				.find((m) => m.path === 'Foo.svelte')
				?.declarations.find((d) => d.name === 'Foo');
			assert.ok(canonical);
			assert.strictEqual(canonical.kind, 'component');
			if (canonical.kind === 'component') {
				assert.strictEqual(canonical.lang, 'js');
			}
		});
	});

	test('component with intersects propagates intersects through the alias', async () => {
		const files = {
			'types.d.ts': `export interface A { extra: string; }`,
			'src/lib/Foo.svelte': `<script lang="ts">
import type {A} from '../../types.js';
let {label, ...rest}: {label: string} & A = $props();
</script>
<button>{label}</button>`,
			'src/lib/index.ts': `export {default as Renamed} from './Foo.svelte';`,
		};

		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});

			const canonical = modules
				.find((m) => m.path === 'Foo.svelte')
				?.declarations.find((d) => d.name === 'Foo');
			assert.ok(canonical);
			assert.strictEqual(canonical.kind, 'component');
			if (canonical.kind === 'component') {
				// Sanity: external A's `extra` property is filtered out, A itself appears in intersects
				assert.deepStrictEqual(canonical.props.map((p) => p.name).sort(), ['label']);
				assert.deepStrictEqual(canonical.intersects, ['A']);
			}

			const renamed = modules
				.find((m) => m.path === 'index.ts')
				?.declarations.find((d) => d.name === 'Renamed');
			assert.ok(renamed);
			assert.strictEqual(renamed.kind, 'component');
			if (renamed.kind === 'component') {
				assert.deepStrictEqual(renamed.intersects, ['A']);
				assert.deepStrictEqual(renamed.props.map((p) => p.name).sort(), ['label']);
			}
		});
	});

	test('chained alias through TS resolves to the deep canonical', async () => {
		const files = {
			'src/lib/Foo.svelte': `<script lang="ts">
let {label}: {label: string} = $props();
</script>
<button>{label}</button>`,
			'src/lib/mid.ts': `export {default as A} from './Foo.svelte';`,
			'src/lib/index.ts': `export {A as B} from './mid.js';`,
		};

		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});

			// First hop: mid.ts has a component alias A → Foo.svelte/Foo
			const midA = modules
				.find((m) => m.path === 'mid.ts')
				?.declarations.find((d) => d.name === 'A');
			assert.ok(midA);
			assert.strictEqual(midA.kind, 'component');
			assert.deepStrictEqual(midA.aliasOf, {
				module: 'Foo.svelte',
				name: 'Foo',
			});
			if (midA.kind === 'component') {
				assert.deepStrictEqual(midA.props.map((p) => p.name).sort(), ['label']);
			}

			// Second hop: index.ts B routes to the deep canonical (Foo.svelte/Foo),
			// matching the rename-then-rename behavior for non-Svelte chains
			const indexB = modules
				.find((m) => m.path === 'index.ts')
				?.declarations.find((d) => d.name === 'B');
			assert.ok(indexB);
			assert.strictEqual(indexB.kind, 'component');
			assert.deepStrictEqual(indexB.aliasOf, {
				module: 'Foo.svelte',
				name: 'Foo',
			});
			if (indexB.kind === 'component') {
				assert.deepStrictEqual(indexB.props.map((p) => p.name).sort(), ['label']);
			}
		});
	});

	test('multiple aliases of the same default each synthesize independently', async () => {
		const files = {
			'src/lib/Foo.svelte': `<script lang="ts">
let {label}: {label: string} = $props();
</script>
<button>{label}</button>`,
			'src/lib/index.ts': `export {default as A, default as B} from './Foo.svelte';`,
		};

		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});

			const indexModule = modules.find((m) => m.path === 'index.ts');
			assert.ok(indexModule);

			for (const name of ['A', 'B']) {
				const decl = indexModule.declarations.find((d) => d.name === name);
				assert.ok(decl, `Should find ${name} declaration`);
				assert.strictEqual(decl.kind, 'component');
				assert.deepStrictEqual(decl.aliasOf, {
					module: 'Foo.svelte',
					name: 'Foo',
				});
				if (decl.kind === 'component') {
					assert.deepStrictEqual(decl.props.map((p) => p.name).sort(), ['label']);
				}
			}
		});
	});
});

describe('multi-hop re-export chains', {timeout: 15_000}, () => {
	test('same-name 3-hop chain accumulates all intermediates on the canonical', async () => {
		const files = {
			'src/lib/a.ts': `
/** Original foo. */
export function foo(): number { return 1; }`,
			'src/lib/b.ts': `export {foo} from './a.js';`,
			'src/lib/c.ts': `export {foo} from './b.js';`,
		};

		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});

			const a = modules.find((m) => m.path === 'a.ts');
			const aFoo = a?.declarations.find((d) => d.name === 'foo');
			assert.ok(aFoo);
			assert.deepStrictEqual(aFoo.alsoExportedFrom, ['b.ts', 'c.ts']);

			// Intermediate modules don't carry their own copy
			assert.strictEqual(modules.find((m) => m.path === 'b.ts')?.declarations.length, 0);
			assert.strictEqual(modules.find((m) => m.path === 'c.ts')?.declarations.length, 0);
		});
	});

	test('rename-then-rename resolves through to the true canonical', async () => {
		const files = {
			'src/lib/a.ts': `
/** Original. */
export function originalFn(x: number): number { return x; }`,
			'src/lib/b.ts': `export {originalFn as middleFn} from './a.js';`,
			'src/lib/c.ts': `export {middleFn as finalFn} from './b.js';`,
		};

		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});

			const c = modules.find((m) => m.path === 'c.ts');
			const finalFn = c?.declarations.find((d) => d.name === 'finalFn');
			assert.ok(finalFn);
			assert.ok(finalFn.aliasOf);
			// Resolves to true canonical, not the intermediate alias
			assert.strictEqual(finalFn.aliasOf.module, 'a.ts');
			assert.strictEqual(finalFn.aliasOf.name, 'originalFn');
			// Inherits the canonical's docComment
			assert.strictEqual(finalFn.docComment, 'Original.');
		});
	});

	test('rename-then-same-name routes c.ts onto b.ts alias via alsoExportedFrom', async () => {
		const files = {
			'src/lib/a.ts': `
/** Original. */
export function originalFn(x: number): number { return x; }`,
			'src/lib/b.ts': `export {originalFn as renamedFn} from './a.js';`,
			'src/lib/c.ts': `export {renamedFn} from './b.js';`,
		};

		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});

			const b = modules.find((m) => m.path === 'b.ts');
			const c = modules.find((m) => m.path === 'c.ts');
			const bRenamed = b?.declarations.find((d) => d.name === 'renamedFn');

			// b.ts holds the renamed alias declaration; c.ts has no duplicate.
			assert.ok(bRenamed);
			assert.deepStrictEqual(bRenamed.alsoExportedFrom, ['c.ts']);
			assert.strictEqual(bRenamed.aliasOf?.module, 'a.ts');
			assert.strictEqual(bRenamed.aliasOf?.name, 'originalFn');
			assert.strictEqual(
				c?.declarations.find((d) => d.name === 'renamedFn'),
				undefined,
			);
		});
	});

	test('same-name then rename works correctly', async () => {
		const files = {
			'src/lib/a.ts': `
/** Original. */
export function foo(x: number): number { return x; }`,
			'src/lib/b.ts': `export {foo} from './a.js';`,
			'src/lib/c.ts': `export {foo as renamedFromB} from './b.js';`,
		};

		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});

			const a = modules.find((m) => m.path === 'a.ts');
			const aFoo = a?.declarations.find((d) => d.name === 'foo');
			assert.ok(aFoo);
			assert.deepStrictEqual(aFoo.alsoExportedFrom, ['b.ts']);

			const c = modules.find((m) => m.path === 'c.ts');
			const renamed = c?.declarations.find((d) => d.name === 'renamedFromB');
			assert.ok(renamed);
			assert.strictEqual(renamed.aliasOf?.module, 'a.ts');
			assert.strictEqual(renamed.aliasOf?.name, 'foo');
		});
	});

	test('4-hop deep same-name chain accumulates all intermediates', async () => {
		const files = {
			'src/lib/a.ts': `
/** Deep canonical. */
export function deep(): void {}`,
			'src/lib/b.ts': `export {deep} from './a.js';`,
			'src/lib/c.ts': `export {deep} from './b.js';`,
			'src/lib/d.ts': `export {deep} from './c.js';`,
		};

		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});

			const a = modules.find((m) => m.path === 'a.ts');
			const aDeep = a?.declarations.find((d) => d.name === 'deep');
			assert.ok(aDeep);
			assert.deepStrictEqual(aDeep.alsoExportedFrom, ['b.ts', 'c.ts', 'd.ts']);
		});
	});
});

describe('JSDoc on cross-file re-export statements', {timeout: 15_000}, () => {
	test('renamed: /** Doc */ export {foo as bar} from "./x.js" attaches local JSDoc to the alias', async () => {
		const files = {
			'src/lib/x.ts': `
/** Original foo doc. */
export function foo(x: number): number { return x; }`,
			'src/lib/index.ts': `
/** Local renamed view. */
export {foo as bar} from './x.js';`,
		};

		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});

			const bar = modules
				.find((m) => m.path === 'index.ts')
				?.declarations.find((d) => d.name === 'bar');
			assert.ok(bar);
			assert.strictEqual(bar.docComment, 'Local renamed view.');
			assert.deepStrictEqual(bar.aliasOf, {module: 'x.ts', name: 'foo'});

			// Canonical's own JSDoc untouched
			const xFoo = modules
				.find((m) => m.path === 'x.ts')
				?.declarations.find((d) => d.name === 'foo');
			assert.strictEqual(xFoo?.docComment, 'Original foo doc.');
		});
	});

	test('renamed: /** @nodocs */ export {foo as bar} from "./x.js" suppresses the alias', async () => {
		const files = {
			'src/lib/x.ts': `
/** Original foo doc. */
export function foo(x: number): number { return x; }`,
			'src/lib/index.ts': `
/** @nodocs */
export {foo as bar} from './x.js';`,
		};

		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});

			// bar must not appear in index.ts declarations
			const indexModule = modules.find((m) => m.path === 'index.ts');
			assert.ok(indexModule);
			assert.strictEqual(
				indexModule.declarations.find((d) => d.name === 'bar'),
				undefined,
			);

			// Canonical foo unaffected
			const xFoo = modules
				.find((m) => m.path === 'x.ts')
				?.declarations.find((d) => d.name === 'foo');
			assert.ok(xFoo);
			assert.strictEqual(xFoo.docComment, 'Original foo doc.');
		});
	});

	test('same-name with JSDoc synthesizes an alias declaration in the re-exporting module', async () => {
		const files = {
			'src/lib/x.ts': `
/** Original foo doc. */
export function foo(x: number): number { return x; }`,
			'src/lib/index.ts': `
/** Local view of foo. */
export {foo} from './x.js';`,
		};

		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});

			// Re-exporting module synthesizes an alias declaration with local JSDoc
			const indexFoo = modules
				.find((m) => m.path === 'index.ts')
				?.declarations.find((d) => d.name === 'foo');
			assert.ok(indexFoo, 'index.ts should synthesize a foo alias declaration');
			assert.strictEqual(indexFoo.docComment, 'Local view of foo.');
			assert.deepStrictEqual(indexFoo.aliasOf, {
				module: 'x.ts',
				name: 'foo',
			});

			// Canonical retains its own JSDoc and gets alsoExportedFrom link
			const xFoo = modules
				.find((m) => m.path === 'x.ts')
				?.declarations.find((d) => d.name === 'foo');
			assert.ok(xFoo);
			assert.strictEqual(xFoo.docComment, 'Original foo doc.');
			assert.deepStrictEqual(xFoo.alsoExportedFrom, ['index.ts']);
		});
	});

	test('same-name with @nodocs suppresses both the alias and alsoExportedFrom link', async () => {
		const files = {
			'src/lib/x.ts': `
/** Original foo doc. */
export function foo(x: number): number { return x; }`,
			'src/lib/index.ts': `
/** @nodocs */
export {foo} from './x.js';`,
		};

		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});

			// No alias declaration in index.ts
			const indexModule = modules.find((m) => m.path === 'index.ts');
			assert.ok(indexModule);
			assert.strictEqual(
				indexModule.declarations.find((d) => d.name === 'foo'),
				undefined,
			);

			// Canonical's alsoExportedFrom does not include index.ts
			const xFoo = modules
				.find((m) => m.path === 'x.ts')
				?.declarations.find((d) => d.name === 'foo');
			assert.ok(xFoo);
			assert.deepStrictEqual(xFoo.alsoExportedFrom, []);
		});
	});

	test('same-name without JSDoc keeps existing behavior (link only, no alias declaration)', async () => {
		const files = {
			'src/lib/x.ts': `
/** Original foo doc. */
export function foo(x: number): number { return x; }`,
			'src/lib/index.ts': `export {foo} from './x.js';`,
		};

		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});

			// No synthesized alias for content-free same-name re-exports
			const indexModule = modules.find((m) => m.path === 'index.ts');
			assert.ok(indexModule);
			assert.strictEqual(
				indexModule.declarations.find((d) => d.name === 'foo'),
				undefined,
			);

			// Canonical gets the alsoExportedFrom link
			const xFoo = modules
				.find((m) => m.path === 'x.ts')
				?.declarations.find((d) => d.name === 'foo');
			assert.deepStrictEqual(xFoo?.alsoExportedFrom, ['index.ts']);
		});
	});

	test('Svelte renamed: /** Doc */ export {default as Foo} from "./Bar.svelte" attaches local JSDoc', async () => {
		const files = {
			'src/lib/Bar.svelte': `<script lang="ts">
/**
 * Bar component canonical doc.
 */
let {label}: {label: string} = $props();
</script>
<button>{label}</button>`,
			'src/lib/index.ts': `
/** Local Foo alias doc. */
export {default as Foo} from './Bar.svelte';`,
		};

		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});

			const foo = modules
				.find((m) => m.path === 'index.ts')
				?.declarations.find((d) => d.name === 'Foo');
			assert.ok(foo);
			assert.strictEqual(foo.kind, 'component');
			assert.strictEqual(foo.docComment, 'Local Foo alias doc.');
			assert.deepStrictEqual(foo.aliasOf, {
				module: 'Bar.svelte',
				name: 'Bar',
			});
			if (foo.kind === 'component') {
				// Phase-2 fixup still propagates props from the canonical
				assert.deepStrictEqual(foo.props.map((p) => p.name).sort(), ['label']);
			}
		});
	});

	test('Svelte same-name with JSDoc synthesizes an alias declaration in the re-exporting module', async () => {
		const files = {
			'src/lib/Foo.svelte': `<script lang="ts">
let {label}: {label: string} = $props();
</script>
<button>{label}</button>`,
			'src/lib/index.ts': `
/** Local view of Foo. */
export {default} from './Foo.svelte';`,
		};

		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});

			// Re-exporting module synthesizes a Foo alias with local JSDoc
			const indexFoo = modules
				.find((m) => m.path === 'index.ts')
				?.declarations.find((d) => d.name === 'Foo');
			assert.ok(indexFoo, 'index.ts should synthesize a Foo alias declaration');
			assert.strictEqual(indexFoo.kind, 'component');
			assert.strictEqual(indexFoo.docComment, 'Local view of Foo.');
			assert.deepStrictEqual(indexFoo.aliasOf, {
				module: 'Foo.svelte',
				name: 'Foo',
			});
			if (indexFoo.kind === 'component') {
				assert.deepStrictEqual(indexFoo.props.map((p) => p.name).sort(), ['label']);
			}

			// Canonical retains alsoExportedFrom link
			const fooComponent = modules
				.find((m) => m.path === 'Foo.svelte')
				?.declarations.find((d) => d.name === 'Foo');
			assert.deepStrictEqual(fooComponent?.alsoExportedFrom, ['index.ts']);
		});
	});

	test("non-Svelte same-name re-export of default links via name: 'default'", async () => {
		// `export {default} from './a.js'` where a.js has `export default function foo`.
		// The canonical's name is `'default'` (the symbol's actual name in JS);
		// `mergeReExports` keys by `(module, name)` like any other re-export.
		const files = {
			'src/lib/a.ts': `export default function foo(): void {}\n`,
			'src/lib/b.ts': `export {default} from './a.js';\n`,
		};

		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});

			const aMod = modules.find((m) => m.path === 'a.ts')!;
			const canonical = aMod.declarations.find((d) => d.name === 'default');
			assert.ok(canonical, 'a.ts canonical should be the default-slot entry');
			assert.strictEqual(canonical.kind, 'function');
			assert.deepStrictEqual(
				canonical.alsoExportedFrom,
				['b.ts'],
				'b.ts should be linked back via alsoExportedFrom',
			);
		});
	});

	test('multi-hop default chain accumulates intermediates on canonical alsoExportedFrom', async () => {
		// Same shape as the named "4-hop deep same-name chain" test, but for
		// defaults. Each hop pushes a `name: 'default'` re-export targeting the
		// canonical; `mergeReExports` resolves uniformly by name within the
		// per-module map.
		const files = {
			'src/lib/a.ts': `export default function deep(): void {}\n`,
			'src/lib/b.ts': `export {default} from './a.js';\n`,
			'src/lib/c.ts': `export {default} from './b.js';\n`,
			'src/lib/d.ts': `export {default} from './c.js';\n`,
		};

		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});

			const aDefault = modules
				.find((m) => m.path === 'a.ts')!
				.declarations.find((d) => d.name === 'default');
			assert.ok(aDefault);
			assert.deepStrictEqual(
				aDefault.alsoExportedFrom,
				['b.ts', 'c.ts', 'd.ts'],
				'Each hop should appear on the canonical, sorted',
			);
		});
	});

	test('non-Svelte renamed-INTO-default (export {foo as default} from "./x") synthesizes default-slot alias', async () => {
		// Rare but legal — TS allows promoting a named import to the default slot
		// at re-export time. The alias entry occupies the consuming module's
		// default slot (`name: 'default'`); `aliasOf.name` points at the canonical
		// (`'foo'`).
		const files = {
			'src/lib/x.ts': `export function foo(): void {}\n`,
			'src/lib/index.ts': `export {foo as default} from './x.js';\n`,
		};

		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});

			const indexMod = modules.find((m) => m.path === 'index.ts')!;
			assert.strictEqual(indexMod.declarations.length, 1);
			const def = indexMod.declarations[0]!;
			assert.strictEqual(def.name, 'default');
			assert.deepStrictEqual(def.aliasOf, {
				module: 'x.ts',
				name: 'foo',
			});
			// Canonical is unchanged — renames don't add to alsoExportedFrom
			const xFoo = modules
				.find((m) => m.path === 'x.ts')!
				.declarations.find((d) => d.name === 'foo');
			assert.deepStrictEqual(xFoo?.alsoExportedFrom, []);
		});
	});

	test('non-Svelte same-name default with JSDoc synthesizes default-slot alias entry (Position 3)', async () => {
		// `/** Doc */ export {default} from './x'` carries local JSDoc — Position 3
		// synthesizes an alias entry in the re-exporting module so the local
		// content has a place to live, plus links via alsoExportedFrom on the
		// canonical. The synthesized entry is itself a default-slot entry
		// (`name: 'default'`) with `aliasOf.name === 'default'` (canonical is
		// also a default).
		const files = {
			'src/lib/a.ts': `export default function foo(): void {}\n`,
			'src/lib/index.ts': `
/** Local view of a's default. */
export {default} from './a.js';
`,
		};

		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});

			const indexMod = modules.find((m) => m.path === 'index.ts')!;
			const synthesized = indexMod.declarations.find((d) => d.name === 'default');
			assert.ok(synthesized, 'index.ts should synthesize a default-slot alias');
			assert.strictEqual(synthesized.kind, 'function');
			assert.strictEqual(synthesized.docComment, "Local view of a's default.");
			assert.strictEqual(synthesized.aliasOf?.module, 'a.ts');
			assert.strictEqual(synthesized.aliasOf?.name, 'default');

			// Canonical also gets alsoExportedFrom — Position 3 keeps the link
			const aDefault = modules
				.find((m) => m.path === 'a.ts')!
				.declarations.find((d) => d.name === 'default');
			assert.deepStrictEqual(aDefault?.alsoExportedFrom, ['index.ts']);
		});
	});

	test('cross-file anonymous defaults do not collide in findDuplicates', async () => {
		// Two modules each have their own `name: 'default'` slot. The default slot
		// is module-scoped per the JS spec, so `findDuplicates` skips
		// `name === 'default'` (no collision).
		const files = {
			'src/lib/a.ts': `export default function foo(): void {}\n`,
			'src/lib/b.ts': `export default function bar(): void {}\n`,
		};

		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});

			const aDefault = modules
				.find((m) => m.path === 'a.ts')!
				.declarations.find((d) => d.name === 'default');
			const bDefault = modules
				.find((m) => m.path === 'b.ts')!
				.declarations.find((d) => d.name === 'default');
			assert.ok(aDefault);
			assert.ok(bDefault);
			// `findDuplicates` skips `name === 'default'` — no collision detected.
			const duplicates = findDuplicates(modules);
			assert.strictEqual(
				duplicates.size,
				0,
				'Anonymous defaults across files should not be flagged as duplicates',
			);
		});
	});
});
