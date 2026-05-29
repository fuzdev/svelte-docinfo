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
 */

import {test, assert, describe} from 'vitest';
import {join} from 'node:path';

import {analyze} from '$lib/analyze.js';
import {hasErrors, hasWarnings} from '$lib/diagnostics.js';
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
			// Synthesized alias has no source location in the re-exporting file
			assert.strictEqual(renamed.sourceLine, undefined);

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
		// `mergeReExports` keys by `(originalModule, name)` like any other re-export.
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

/**
 * `export * as ns from './x'` synthesizes a `kind: 'namespace'` declaration in
 * the re-exporting module. The declaration carries a `module` field pointing at
 * the source module — consumers that want to render `ns.a`/`ns.b` deref by
 * reading that module's declarations.
 */
describe('namespace re-exports (export * as ns from ./x)', {timeout: 15_000}, () => {
	test('synthesizes kind:namespace with module pointer; no path leak', async () => {
		const files = {
			'src/lib/x.ts': `
/** First export. */
export const a = 1;
/** Second export. */
export function b(): void {}
/** Third export — a type. */
export type C = {value: string};
`,
			'src/lib/index.ts': `export * as ns from './x.js';`,
		};

		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules, diagnostics} = await analyze({sourceFiles, sourceOptions});

			const indexModule = modules.find((m) => m.path === 'index.ts');
			assert.ok(indexModule);

			// The phantom kind:'variable' is gone — only the namespace declaration.
			const decls = indexModule.declarations;
			assert.strictEqual(decls.length, 1);
			const ns = decls[0]!;
			assert.strictEqual(ns.name, 'ns');
			assert.strictEqual(ns.kind, 'namespace');
			if (ns.kind === 'namespace') {
				assert.strictEqual(ns.module, 'x.ts');
			}
			// Source line points at the export statement in index.ts.
			assert.strictEqual(ns.sourceLine, 1);

			// Star exports remain anonymous-only (`export * from`), unaffected.
			assert.deepStrictEqual(indexModule.starExports, []);

			// No diagnostics — clean handling.
			assert.strictEqual(hasErrors(diagnostics), false);
			assert.strictEqual(hasWarnings(diagnostics), false);

			// The serialized form must not contain any absolute path leak.
			const json = JSON.stringify(modules);
			assert.notMatch(
				json,
				/typeof import\("\//,
				'no `typeof import("/abs/path")` leak in JSON output',
			);
			assert(!json.includes(projectRoot), 'no absolute project path leak in JSON output');
		});
	});

	test('JSDoc on the namespace re-export attaches to the declaration', async () => {
		const files = {
			'src/lib/x.ts': `export const a = 1;`,
			'src/lib/index.ts': `
/** Grouped projection of x's exports.
 * @example import * as ns from 'pkg/index.js';
 */
export * as ns from './x.js';`,
		};

		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});
			const ns = modules
				.find((m) => m.path === 'index.ts')
				?.declarations.find((d) => d.name === 'ns');
			assert.ok(ns);
			assert.strictEqual(ns.kind, 'namespace');
			assert.strictEqual(ns.docComment, "Grouped projection of x's exports.");
			assert.deepStrictEqual(ns.examples, ["import * as ns from 'pkg/index.js';"]);
		});
	});

	test('@nodocs on the namespace re-export marks the declaration', async () => {
		const files = {
			'src/lib/x.ts': `export const a = 1;`,
			'src/lib/index.ts': `
/** @nodocs */
export * as ns from './x.js';`,
		};

		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});
			const indexModule = modules.find((m) => m.path === 'index.ts');
			assert.ok(indexModule);
			// The default await analyze() filter excludes @nodocs declarations from output.
			assert.deepStrictEqual(indexModule.declarations, []);
		});
	});

	test('namespace name participates in flat-namespace duplicate detection', async () => {
		const files = {
			'src/lib/x.ts': `export const value = 1;`,
			'src/lib/y.ts': `export const ns = 'collision';`,
			'src/lib/index.ts': `
export * as ns from './x.js';
export {ns as renamed} from './y.js'; // referenced to keep ns in scope
`,
		};

		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});
			// The namespace declaration is named `ns`; the variable in y.ts is also `ns`.
			// findDuplicates is consumer-side, but the declaration's `name` field
			// participates in the flat namespace just like any other declaration.
			const indexNs = modules
				.find((m) => m.path === 'index.ts')
				?.declarations.find((d) => d.name === 'ns');
			const yNs = modules.find((m) => m.path === 'y.ts')?.declarations.find((d) => d.name === 'ns');
			assert.ok(indexNs);
			assert.ok(yNs);
			assert.strictEqual(indexNs.kind, 'namespace');
			assert.strictEqual(yNs.kind, 'variable');
		});
	});

	test('cross-file same-name re-export of a namespace links via alsoExportedFrom', async () => {
		const files = {
			'src/lib/x.ts': `export const a = 1;`,
			'src/lib/index.ts': `export * as ns from './x.js';`,
			'src/lib/barrel.ts': `export {ns} from './index.js';`,
		};
		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});
			const barrel = modules.find((m) => m.path === 'barrel.ts');
			const indexNs = modules
				.find((m) => m.path === 'index.ts')
				?.declarations.find((d) => d.name === 'ns');
			assert.ok(indexNs);
			assert.deepStrictEqual(barrel?.declarations, []);
			assert.deepStrictEqual(indexNs.alsoExportedFrom, ['barrel.ts']);
		});
	});

	test('star re-export of a module containing a namespace links via alsoExportedFrom (no duplicate decl)', async () => {
		// Regression guard for the star-export-of-namespace case.
		// Without the `getSourceFile() === sourceFile` guard in analyzeExports,
		// the star-projected `ns` symbol would re-fire the namespace branch and
		// synthesize a duplicate declaration in barrel-star.ts.
		const files = {
			'src/lib/x.ts': `export const a = 1;`,
			'src/lib/index.ts': `export * as ns from './x.js';`,
			'src/lib/barrel-star.ts': `export * from './index.js';`,
		};
		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});
			const barrelStar = modules.find((m) => m.path === 'barrel-star.ts');
			const indexNs = modules
				.find((m) => m.path === 'index.ts')
				?.declarations.find((d) => d.name === 'ns');
			assert.ok(indexNs);
			assert.deepStrictEqual(
				barrelStar?.declarations,
				[],
				'no duplicate ns declaration in the star-importing module',
			);
			assert.deepStrictEqual(barrelStar?.starExports, ['index.ts']);
			assert.deepStrictEqual(
				indexNs.alsoExportedFrom.sort(),
				['barrel-star.ts'],
				'star-importer registers as alsoExportedFrom on the canonical namespace',
			);
		});
	});

	test('renamed cross-file re-export of a namespace synthesizes a kind:namespace alias', async () => {
		const files = {
			'src/lib/x.ts': `export const a = 1;`,
			'src/lib/index.ts': `export * as ns from './x.js';`,
			'src/lib/renamed.ts': `
/** A friendlier name for ns. */
export {ns as renamedNs} from './index.js';`,
		};
		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});
			const renamed = modules.find((m) => m.path === 'renamed.ts');
			assert.ok(renamed);
			assert.strictEqual(renamed.declarations.length, 1);
			const decl = renamed.declarations[0]!;
			assert.strictEqual(decl.name, 'renamedNs');
			assert.strictEqual(decl.kind, 'namespace');
			if (decl.kind === 'namespace') {
				// `module` points to the source the namespace projects (not the
				// namespace-defining module).
				assert.strictEqual(decl.module, 'x.ts');
			}
			// aliasOf points to the canonical namespace declaration in index.ts.
			assert.deepStrictEqual(decl.aliasOf, {
				module: 'index.ts',
				name: 'ns',
			});
			assert.strictEqual(decl.docComment, 'A friendlier name for ns.');
			// Synthesized alias has no source location in renamed.ts.
			assert.strictEqual(decl.sourceLine, undefined);

			// No path leak in the JSON output.
			const json = JSON.stringify(modules);
			assert.notMatch(json, /typeof import\("\//);
		});
	});

	test('namespace re-export of a Svelte module points module at the .svelte file', async () => {
		const files = {
			'src/lib/Foo.svelte': `<script lang="ts">
let {label}: {label: string} = $props();
</script>
<button>{label}</button>`,
			'src/lib/index.ts': `export * as FooNs from './Foo.svelte';`,
		};

		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});
			const ns = modules
				.find((m) => m.path === 'index.ts')
				?.declarations.find((d) => d.name === 'FooNs');
			assert.ok(ns);
			assert.strictEqual(ns.kind, 'namespace');
			if (ns.kind === 'namespace') {
				assert.strictEqual(ns.module, 'Foo.svelte');
			}
		});
	});

	// Lock-in tests for the chained-namespace path-leak fix. Detection used to
	// rely on `getImmediateAliasedSymbol(exportSymbol).declarations[0]` being a
	// `NamespaceExport`, which fails when intermediate hops are `ExportSpecifier`
	// nodes. The fix uses the `ValueModule` flag on the deeply-resolved alias,
	// which is robust to arbitrary chain depth.
	test('3-hop chain (origination → same-name → renamed) classifies as renamed and points aliasOf at the origination', async () => {
		const files = {
			'src/lib/x.ts': `export const a = 1;`,
			'src/lib/a.ts': `export * as ns from './x.js';`,
			'src/lib/b.ts': `export {ns} from './a.js';`,
			'src/lib/c.ts': `export {ns as foo} from './b.js';`,
		};
		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});

			const c = modules.find((m) => m.path === 'c.ts');
			assert.ok(c);
			assert.strictEqual(c.declarations.length, 1);
			const foo = c.declarations[0]!;
			assert.strictEqual(foo.name, 'foo');
			assert.strictEqual(foo.kind, 'namespace');
			if (foo.kind === 'namespace') {
				// `module` points to the source the namespace projects (x.ts),
				// not the abs-path leak that the previous detection produced.
				assert.strictEqual(foo.module, 'x.ts');
			}
			// aliasOf walks the chain to the canonical NamespaceExport in a.ts,
			// not the deeply-resolved module symbol (which would have an abs-path name).
			assert.deepStrictEqual(foo.aliasOf, {module: 'a.ts', name: 'ns'});
			assert.strictEqual(foo.sourceLine, undefined);

			// b.ts's same-name re-export still links via alsoExportedFrom on a.ts's ns.
			const aNs = modules.find((m) => m.path === 'a.ts')?.declarations.find((d) => d.name === 'ns');
			assert.ok(aNs);
			assert.deepStrictEqual(aNs.alsoExportedFrom, ['b.ts']);

			// No path leak anywhere in the JSON output.
			const json = JSON.stringify(modules);
			assert.notMatch(json, /typeof import\("\//, 'no typeof import("/abs/path") leak');
			assert(!json.includes(projectRoot), 'no absolute project path leak');
		});
	});

	test('4-hop chain crossing same-name and renamed segments resolves correctly with no path leak', async () => {
		const files = {
			'src/lib/x.ts': `export const a = 1;`,
			'src/lib/a.ts': `export * as ns from './x.js';`,
			'src/lib/b.ts': `export {ns as renamed} from './a.js';`,
			'src/lib/c.ts': `export {renamed} from './b.js';`,
			'src/lib/d.ts': `export {renamed as final} from './c.js';`,
		};
		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});

			// b.ts's renamed alias declaration is the upstream rename.
			const b = modules.find((m) => m.path === 'b.ts');
			const bRenamed = b?.declarations.find((d) => d.name === 'renamed');
			assert.ok(bRenamed);
			assert.strictEqual(bRenamed.kind, 'namespace');
			if (bRenamed.kind === 'namespace') {
				assert.strictEqual(bRenamed.module, 'x.ts');
			}
			assert.deepStrictEqual(bRenamed.aliasOf, {module: 'a.ts', name: 'ns'});
			// c.ts's same-name re-export links to b.ts's renamed alias.
			assert.deepStrictEqual(bRenamed.alsoExportedFrom, ['c.ts']);

			// d.ts's renamed re-export synthesizes a fresh alias pointing at the
			// upstream NamespaceExport (a.ts's ns), not the intermediate b.ts/renamed.
			// This matches the rename-then-rename semantics for non-namespace decls.
			const d = modules.find((m) => m.path === 'd.ts');
			const final = d?.declarations.find((dd) => dd.name === 'final');
			assert.ok(final);
			assert.strictEqual(final.kind, 'namespace');
			if (final.kind === 'namespace') {
				assert.strictEqual(final.module, 'x.ts');
			}
			assert.deepStrictEqual(final.aliasOf, {module: 'a.ts', name: 'ns'});

			const json = JSON.stringify(modules);
			assert.notMatch(json, /typeof import\("\//, 'no typeof import("/abs/path") leak');
			assert(!json.includes(projectRoot), 'no absolute project path leak');
		});
	});

	test('JSDoc on a same-name cross-file namespace re-export synthesizes a kind:namespace alias and still links the canonical', async () => {
		// Position 3 (content-conditional synthesis): when the local statement
		// carries JSDoc, synthesize an alias declaration so the local content
		// has somewhere to live, AND keep the alsoExportedFrom link.
		const files = {
			'src/lib/x.ts': `export const a = 1;`,
			'src/lib/index.ts': `export * as ns from './x.js';`,
			'src/lib/barrel.ts': `
/** Re-projected for convenience.
 * @example import {ns} from 'pkg/barrel.js';
 */
export {ns} from './index.js';`,
		};
		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});

			const barrel = modules.find((m) => m.path === 'barrel.ts');
			assert.ok(barrel);
			const barrelNs = barrel.declarations.find((d) => d.name === 'ns');
			assert.ok(barrelNs, 'barrel.ts synthesizes a ns alias declaration when JSDoc is present');
			assert.strictEqual(barrelNs.kind, 'namespace');
			if (barrelNs.kind === 'namespace') {
				assert.strictEqual(barrelNs.module, 'x.ts');
			}
			assert.deepStrictEqual(barrelNs.aliasOf, {
				module: 'index.ts',
				name: 'ns',
			});
			assert.strictEqual(barrelNs.docComment, 'Re-projected for convenience.');
			assert.deepStrictEqual(barrelNs.examples, ["import {ns} from 'pkg/barrel.js';"]);
			assert.strictEqual(barrelNs.sourceLine, undefined);

			// alsoExportedFrom on the canonical is preserved (link + alias coexist).
			const indexNs = modules
				.find((m) => m.path === 'index.ts')
				?.declarations.find((d) => d.name === 'ns');
			assert.ok(indexNs);
			assert.deepStrictEqual(indexNs.alsoExportedFrom, ['barrel.ts']);

			const json = JSON.stringify(modules);
			assert.notMatch(json, /typeof import\("\//, 'no typeof import("/abs/path") leak');
			assert(!json.includes(projectRoot), 'no absolute project path leak');
		});
	});

	test('@nodocs on a same-name cross-file namespace re-export suppresses both the alias and the alsoExportedFrom link', async () => {
		const files = {
			'src/lib/x.ts': `export const a = 1;`,
			'src/lib/index.ts': `export * as ns from './x.js';`,
			'src/lib/barrel.ts': `
/** @nodocs */
export {ns} from './index.js';`,
		};
		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});

			// The default await analyze() filter excludes @nodocs declarations, and
			// the alsoExportedFrom link was suppressed.
			const barrel = modules.find((m) => m.path === 'barrel.ts');
			assert.deepStrictEqual(barrel?.declarations, []);
			const indexNs = modules
				.find((m) => m.path === 'index.ts')
				?.declarations.find((d) => d.name === 'ns');
			assert.ok(indexNs);
			assert.deepStrictEqual(indexNs.alsoExportedFrom, []);
		});
	});

	test('chain ending in same-name links to the upstream renamed alias via alsoExportedFrom (no synthesized decl)', async () => {
		const files = {
			'src/lib/x.ts': `export const a = 1;`,
			'src/lib/a.ts': `export * as ns from './x.js';`,
			'src/lib/b.ts': `export {ns as foo} from './a.js';`,
			'src/lib/c.ts': `export {foo} from './b.js';`,
		};
		await withTestProject(files, async (projectRoot) => {
			const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
			const {modules} = await analyze({sourceFiles, sourceOptions});

			// b.ts holds the canonical-for-name (the renamed alias `foo`).
			const b = modules.find((m) => m.path === 'b.ts');
			const bFoo = b?.declarations.find((d) => d.name === 'foo');
			assert.ok(bFoo);
			assert.strictEqual(bFoo.kind, 'namespace');
			assert.deepStrictEqual(bFoo.alsoExportedFrom, ['c.ts']);

			// c.ts has no duplicate declaration — same-name re-export only links.
			const c = modules.find((m) => m.path === 'c.ts');
			assert.deepStrictEqual(c?.declarations, []);

			const json = JSON.stringify(modules);
			assert.notMatch(json, /typeof import\("\//, 'no typeof import("/abs/path") leak');
			assert(!json.includes(projectRoot), 'no absolute project path leak');
		});
	});
});
