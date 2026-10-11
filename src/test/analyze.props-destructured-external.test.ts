/**
 * Destructured external props — a prop the `$props()` destructuring names is
 * documented even when its declaration lives in a package, while the rest of
 * the external bag stays filtered and recorded in `externalTypes`. The svelte
 * fixtures (`props/destructured-external*`) lock the single-file shapes against
 * `svelte/elements`; these cases cover what they can't: a synthetic package
 * whose properties carry JSDoc, a props type imported from a sibling module,
 * non-destructured `$props()`, nested patterns, and generic components.
 */

import { test, assert, describe } from 'vitest';
import { join } from 'node:path';

import { analyze } from '#lib/analyze.ts';
import type { ComponentDeclarationJson } from '#lib/types.ts';
import { createSourceOptions } from '#lib/source-config.ts';

import { withTestProject } from './test-helpers.ts';

const EXTERNAL_PKG = {
	'node_modules/extpkg/package.json': JSON.stringify({
		name: 'extpkg',
		version: '1.0.0',
		types: 'index.d.ts'
	}),
	'node_modules/extpkg/index.d.ts': `export interface Bag {
	/**
	 * Description e1
	 * @default 'e'
	 */
	e1?: string;
	e2?: number;
	e3?: {x: string};
	e4?: number;
}
`
};

const analyzeComponent = async (
	files: Record<string, string>,
	componentPath: string
): Promise<ComponentDeclarationJson> => {
	let component: ComponentDeclarationJson | undefined;
	await withTestProject(files, async (projectRoot) => {
		const sourceFiles = Object.entries(files)
			.filter(([path]) => path.startsWith('src/'))
			.map(([path, content]) => ({ id: join(projectRoot, path), content }));
		const { modules } = await analyze({
			sourceFiles,
			sourceOptions: createSourceOptions(projectRoot)
		});
		const decl = modules
			.find((m) => m.path === componentPath)
			?.declarations.find((d) => d.kind === 'component');
		assert(decl?.kind === 'component');
		component = decl;
	});
	assert(component);
	return component;
};

describe('destructured external props', { timeout: 15_000 }, () => {
	test('a destructured external prop keeps its external JSDoc and takes the destructuring default', async () => {
		const component = await analyzeComponent(
			{
				...EXTERNAL_PKG,
				'src/lib/A.svelte': `<script lang="ts">
	import type {Bag} from 'extpkg';

	const {prop1, e2 = 1, e1, ...rest}: {prop1?: string} & Bag = $props();
</script>

<div {...rest}>{prop1}{e1}{e2}</div>
`
			},
			'A.svelte'
		);
		assert.deepEqual(component.externalTypes, ['Bag']);
		// local props first, then admitted ones in destructuring order
		assert.deepEqual(
			component.props.map((p) => p.name),
			['prop1', 'e2', 'e1']
		);
		const [, e2, e1] = component.props;
		assert.strictEqual(e2?.type, 'number');
		assert.strictEqual(e2?.defaultValue, '1');
		assert.strictEqual(e1?.description, 'Description e1');
		// no destructuring default, so the external `@default` tag is the fallback
		assert.strictEqual(e1?.defaultValue, "'e'");
	});

	test('a props type imported from a sibling module admits through the import', async () => {
		const component = await analyzeComponent(
			{
				...EXTERNAL_PKG,
				'src/lib/types.ts': `import type {Bag} from 'extpkg';

export interface AProps extends Bag {
	prop1?: string;
}
`,
				'src/lib/A.svelte': `<script lang="ts">
	import type {AProps} from './types.js';

	const {e4: a = 2, prop1, ...rest}: AProps = $props();
</script>

<div {...rest}>{prop1}{a}</div>
`
			},
			'A.svelte'
		);
		assert.deepEqual(component.externalTypes, ['Bag']);
		assert.deepEqual(
			component.props.map((p) => [p.name, p.defaultValue]),
			[
				['prop1', undefined],
				['e4', '2']
			]
		);
	});

	test('non-destructured $props() admits nothing', async () => {
		const component = await analyzeComponent(
			{
				...EXTERNAL_PKG,
				'src/lib/A.svelte': `<script lang="ts">
	import type {Bag} from 'extpkg';

	const props: {prop1?: string} & Bag = $props();
</script>

<div>{props.prop1}{props.e1}</div>
`
			},
			'A.svelte'
		);
		assert.deepEqual(component.externalTypes, ['Bag']);
		assert.deepEqual(
			component.props.map((p) => p.name),
			['prop1']
		);
	});

	test('a nested pattern documents its top-level name', async () => {
		const component = await analyzeComponent(
			{
				...EXTERNAL_PKG,
				'src/lib/A.svelte': `<script lang="ts">
	import type {Bag} from 'extpkg';

	const {e3: {x} = {x: 'a'}}: Bag = $props();
</script>

<div>{x}</div>
`
			},
			'A.svelte'
		);
		assert.deepEqual(
			component.props.map((p) => [p.name, p.type, p.defaultValue]),
			[['e3', '{ x: string; }', "{x: 'a'}"]]
		);
	});

	test('a generic component admits external props beside its own generic ones', async () => {
		const component = await analyzeComponent(
			{
				...EXTERNAL_PKG,
				'src/lib/A.svelte': `<script lang="ts" generics="T">
	import type {Bag} from 'extpkg';

	const {prop1, e2, ...rest}: {prop1: T} & Bag = $props();
</script>

<div {...rest}>{prop1}{e2}</div>
`
			},
			'A.svelte'
		);
		assert.deepEqual(component.externalTypes, ['Bag']);
		assert.deepEqual(
			component.props.map((p) => [p.name, p.type]),
			[
				['prop1', 'T'],
				['e2', 'number']
			]
		);
	});

	test('a renamed prop keys its default by the prop name, local props included', async () => {
		const component = await analyzeComponent(
			{
				'src/lib/A.svelte': `<script lang="ts">
	let {
		prop1: a = 'a',
		'prop-2': b = 2,
		prop3: c = $bindable(3)
	}: {prop1?: string; 'prop-2'?: number; prop3?: number} = $props();
</script>

<div>{a}{b}{c}</div>
`
			},
			'A.svelte'
		);
		assert.deepEqual(
			component.props.map((p) => [p.name, p.defaultValue]),
			[
				['prop1', "'a'"],
				['prop-2', '2'],
				['prop3', '3']
			]
		);
	});

	test('a quoted element admits its prop, and the rest element admits none, even one its binding names', async () => {
		const component = await analyzeComponent(
			{
				...EXTERNAL_PKG,
				'src/lib/A.svelte': `<script lang="ts">
	import type {Bag} from 'extpkg';

	const {'e1': a, ...e2}: Bag = $props();
</script>

<div {...e2}>{a}</div>
`
			},
			'A.svelte'
		);
		assert.deepEqual(
			component.props.map((p) => p.name),
			['e1']
		);
	});
});
