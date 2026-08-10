/**
 * Cross-module component props — the `$props()` annotation references a type
 * declared in a sibling project module rather than in the `.svelte` file. This
 * is the dominant pattern in real-world Svelte libraries (a central `types.ts`
 * of props interfaces, or per-component shared-type modules), so it gets
 * behavior-level lock-in even though the walk's mechanics are unit-tested in
 * `external-properties.test.ts` (the svelte fixture harness is single-file, so
 * fixtures can't model it).
 *
 * Each case locks the two views of one composition in one output: the
 * component's `externalTypes` descends through the imported name to the external
 * bags it composes, while the sibling module documents the type itself
 * (verbatim `extends` on an interface, `externalTypes` + members on an alias).
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
): Array<SourceFileInfo> =>
	Object.entries(files)
		.filter(([path]) => path.endsWith('.ts') || path.endsWith('.svelte'))
		.map(([path, content]) => ({ id: join(projectRoot, path), content }));

const EXTERNAL_PKG = {
	'node_modules/extpkg/package.json': JSON.stringify({
		name: 'extpkg',
		version: '1.0.0',
		types: 'index.d.ts'
	}),
	'node_modules/extpkg/index.d.ts': `export interface Bag { e1?: string; e2?: number }`
};

describe('cross-module props types', { timeout: 15_000 }, () => {
	test('imported interface with extends: component records the bag, module records the heritage', async () => {
		const files = {
			...EXTERNAL_PKG,
			'src/lib/types.ts': `import type {Bag} from 'extpkg';

/** Description A. */
export interface AProps extends Bag {
	/** Description 1 */
	prop1?: string;
}
`,
			'src/lib/A.svelte': `<script lang="ts">
	import type {AProps} from './types.js';

	const {prop1, ...rest}: AProps = $props();
</script>

<div {...rest}>{prop1}</div>
`
		};
		await withTestProject(files, async (projectRoot) => {
			const sourceFiles = createSourceFiles(projectRoot, files);
			const sourceOptions = createSourceOptions(projectRoot);
			const { modules } = await analyze({ sourceFiles, sourceOptions });

			const component = modules
				.find((m) => m.path === 'A.svelte')
				?.declarations.find((d) => d.kind === 'component');
			assert(component?.kind === 'component');
			// the descent follows the import to `types.ts` and reads the heritage there
			assert.deepEqual(component.externalTypes, ['Bag']);
			assert.deepEqual(
				component.props.map((p) => p.name),
				['prop1']
			);
			assert.strictEqual(component.props[0]?.description, 'Description 1');

			// the sibling module documents the interface itself, verbatim heritage
			const iface = modules
				.find((m) => m.path === 'types.ts')
				?.declarations.find((d) => d.name === 'AProps');
			assert(iface?.kind === 'interface');
			assert.deepEqual(iface.extends, ['Bag']);
			assert.deepEqual(
				iface.members.map((m) => m.name),
				['prop1']
			);
		});
	});

	test('imported alias with an intersection: both views record the bag', async () => {
		const files = {
			...EXTERNAL_PKG,
			'src/lib/types.ts': `import type {Bag} from 'extpkg';

export type BProps = Bag & {
	/** Description 1 */
	prop1?: string;
};
`,
			'src/lib/B.svelte': `<script lang="ts">
	import type {BProps} from './types.js';

	const {prop1, ...rest}: BProps = $props();
</script>

<div {...rest}>{prop1}</div>
`
		};
		await withTestProject(files, async (projectRoot) => {
			const sourceFiles = createSourceFiles(projectRoot, files);
			const sourceOptions = createSourceOptions(projectRoot);
			const { modules } = await analyze({ sourceFiles, sourceOptions });

			const component = modules
				.find((m) => m.path === 'B.svelte')
				?.declarations.find((d) => d.kind === 'component');
			assert(component?.kind === 'component');
			assert.deepEqual(component.externalTypes, ['Bag']);
			assert.deepEqual(
				component.props.map((p) => p.name),
				['prop1']
			);

			const alias = modules
				.find((m) => m.path === 'types.ts')
				?.declarations.find((d) => d.name === 'BProps');
			assert(alias?.kind === 'type');
			assert.deepEqual(alias.externalTypes, ['Bag']);
			assert.deepEqual(
				alias.members.map((m) => m.name),
				['prop1']
			);
		});
	});

	test('a rename in the sibling module records the name the package exports', async () => {
		// The sibling module is free to bind the bag under any local name; `B`
		// is meaningless at the component, which imports only `AProps`.
		const files = {
			...EXTERNAL_PKG,
			'src/lib/types.ts': `import type {Bag as B} from 'extpkg';

export interface AProps extends B {
	prop1?: string;
}
`,
			'src/lib/A.svelte': `<script lang="ts">
	import type {AProps} from './types.js';

	const {prop1, ...rest}: AProps = $props();
</script>

<div {...rest}>{prop1}</div>
`
		};
		await withTestProject(files, async (projectRoot) => {
			const sourceFiles = createSourceFiles(projectRoot, files);
			const sourceOptions = createSourceOptions(projectRoot);
			const { modules } = await analyze({ sourceFiles, sourceOptions });

			const component = modules
				.find((m) => m.path === 'A.svelte')
				?.declarations.find((d) => d.kind === 'component');
			assert(component?.kind === 'component');
			assert.deepEqual(component.externalTypes, ['Bag']);

			// the interface's own `extends` is verbatim own-clause text, so it
			// keeps the local spelling — the two fields answer different
			// questions, and only the descent crosses the module boundary
			const iface = modules
				.find((m) => m.path === 'types.ts')
				?.declarations.find((d) => d.name === 'AProps');
			assert(iface?.kind === 'interface');
			assert.deepEqual(iface.extends, ['B']);
		});
	});

	test('one bag reached through two sibling modules is one contributor', async () => {
		const files = {
			...EXTERNAL_PKG,
			'src/lib/one.ts': `import type {Bag} from 'extpkg';

export interface One extends Bag { a?: string }
`,
			'src/lib/two.ts': `import type {Bag as B} from 'extpkg';

export interface Two extends B { b?: string }
`,
			'src/lib/C.svelte': `<script lang="ts">
	import type {One} from './one.js';
	import type {Two} from './two.js';

	const {a, b, ...rest}: One & Two = $props();
</script>

<div {...rest}>{a}{b}</div>
`
		};
		await withTestProject(files, async (projectRoot) => {
			const sourceFiles = createSourceFiles(projectRoot, files);
			const sourceOptions = createSourceOptions(projectRoot);
			const { modules } = await analyze({ sourceFiles, sourceOptions });

			const component = modules
				.find((m) => m.path === 'C.svelte')
				?.declarations.find((d) => d.kind === 'component');
			assert(component?.kind === 'component');
			assert.deepEqual(component.externalTypes, ['Bag']);
			assert.deepEqual(component.props.map((p) => p.name).sort(), ['a', 'b']);
		});
	});

	test('a package that renames on the way out keeps its public name', async () => {
		// Why rename resolution is one hop and not `getAliasedSymbol`: the full
		// chain ends at `InternalFoo`, the declaration's own name, which
		// `extpkg` never exports. The specifier's property name is the package's
		// public name whether or not the importing module renamed it again.
		const files = {
			'node_modules/extpkg/package.json': JSON.stringify({
				name: 'extpkg',
				version: '1.0.0',
				types: 'index.d.ts'
			}),
			'node_modules/extpkg/impl.d.ts': `export interface InternalFoo { e1?: string }`,
			'node_modules/extpkg/index.d.ts': `export {InternalFoo as PublicFoo} from './impl.js';`,
			'src/lib/types.ts': `import type {PublicFoo as P} from 'extpkg';

export interface DProps extends P {
	prop1?: string;
}
`,
			'src/lib/D.svelte': `<script lang="ts">
	import type {DProps} from './types.js';

	const {prop1, ...rest}: DProps = $props();
</script>

<div {...rest}>{prop1}</div>
`
		};
		await withTestProject(files, async (projectRoot) => {
			const sourceFiles = createSourceFiles(projectRoot, files);
			const sourceOptions = createSourceOptions(projectRoot);
			const { modules } = await analyze({ sourceFiles, sourceOptions });

			const component = modules
				.find((m) => m.path === 'D.svelte')
				?.declarations.find((d) => d.kind === 'component');
			assert(component?.kind === 'component');
			assert.deepEqual(component.externalTypes, ['PublicFoo']);
		});
	});
});
