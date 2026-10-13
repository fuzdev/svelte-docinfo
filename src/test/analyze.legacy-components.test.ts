/**
 * Tests for legacy (runes-less) components, which declare props with
 * `export let` instead of `$props()`, through the `analyze` pipeline.
 *
 * The `legacy-*` svelte fixtures lock the extractor's output per shape. These
 * tests cover what a fixture can't pin or states less directly:
 *
 * 1. which exports are props — the forms the scan counts, accessors and
 *    module-script exports staying out, scripts nested in the template, the
 *    interface form of `$$Props`
 * 2. the component doc — with no `$props()` anchor the in-script doc slot
 *    doesn't exist, so a documented `export let` can't leak into the component
 *    `docComment`; the HTML `@component` comment is the only source
 * 3. the mode — a component svelte2tsx reads as runes has no legacy props
 * 4. a legacy component reached through a re-export and through disk discovery
 *
 * The scan on its own is in `svelte-legacy.test.ts`, the refusals in
 * `analyze.legacy-refusal.test.ts`, and session edits in
 * `analyze.svelte-session.test.ts`.
 */

import { test, assert, describe } from 'vitest';
import { join } from 'node:path';

import type { ComponentDeclarationJson } from '#lib/types.ts';
import { analyze, analyzeFromFiles } from '#lib/analyze.ts';

import { assertHasProps, findComponent, findModule, withTestProject } from './test-helpers.ts';
import { analyzeTestProject, testSourceOptions } from './test-module-helpers.ts';

/** Assert a component's prop names, in order, and return the props. */
const propsOf = (
	component: ComponentDeclarationJson,
	names: Array<string>
): ComponentDeclarationJson['props'] => {
	assertHasProps(component, names);
	return component.props;
};

describe('legacy export let components', () => {
	test('extracts props with no diagnostic, and keeps them out of the component doc', async () => {
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/Comp.svelte': `<script lang="ts">
	/** Description 1 */
	export let prop1: string;
	export let prop2 = 1;
</script>
<div>{prop1} {prop2}</div>
`
		});

		const component = findComponent(modules);
		assert.deepStrictEqual(
			component.props.map(({ name, type, optional, bindable, description, defaultValue }) => ({
				name,
				type,
				optional,
				bindable,
				description,
				defaultValue
			})),
			[
				{
					name: 'prop1',
					type: 'string',
					optional: false,
					bindable: true,
					description: 'Description 1',
					defaultValue: undefined
				},
				{
					name: 'prop2',
					type: 'number',
					optional: true,
					bindable: true,
					description: undefined,
					defaultValue: '1'
				}
			]
		);
		// the documented export let must not leak into the component doc
		assert.strictEqual(component.docComment, undefined);
		assert.deepStrictEqual(diagnostics, []);
	});

	test('HTML @component comment is the docComment for a legacy component', async () => {
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/Comp.svelte': `<!--
@component
Description.
-->
<script>
	/** Description 1 */
	export let prop1;
</script>
<div>{prop1}</div>
`
		});

		const component = findComponent(modules);
		assert.strictEqual(component.docComment, 'Description.');
		assert.strictEqual(component.lang, 'js');
		const [prop] = propsOf(component, ['prop1']);
		assert.strictEqual(prop!.description, 'Description 1');
		// the script slot stayed empty, so no script-vs-html duplicate warning
		assert.deepStrictEqual(diagnostics, []);
	});

	test('export-clause renames of mutable bindings count; const and type-only do not', async () => {
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/Comp.svelte': `<script lang="ts">
	type T = number;
	let a = true;
	const b = 1;
	export { a as prop1, b };
	export type { T };
</script>
<div>{a} {b}</div>
`
		});

		// exported name, not the local binding; `b` (const) and `T` excluded
		const [prop] = propsOf(findComponent(modules), ['prop1']);
		assert.strictEqual(prop!.type, 'boolean');
		assert.strictEqual(prop!.defaultValue, 'true');
		assert.deepStrictEqual(diagnostics, []);
	});

	test('export var and a clause both count, in export order', async () => {
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/Comp.svelte': `<script lang="ts">
	let a: string;
	export { a as prop2 };
	export var prop1 = 1;
</script>
<div>{prop1} {a}</div>
`
		});

		// source order of the exports, not of the bindings
		const [prop2, prop1] = propsOf(findComponent(modules), ['prop2', 'prop1']);
		assert.strictEqual(prop2!.type, 'string');
		assert.isFalse(prop2!.optional);
		assert.strictEqual(prop1!.type, 'number');
		assert.isTrue(prop1!.optional);
		assert.deepStrictEqual(diagnostics, []);
	});

	test('a clause above its binding still names the prop', async () => {
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/Comp.svelte': `<script lang="ts">
	export { a as prop1 };
	let a: string;
</script>
<div>{a}</div>
`
		});

		const [prop] = propsOf(findComponent(modules), ['prop1']);
		assert.strictEqual(prop!.type, 'string');
		assert.deepStrictEqual(diagnostics, []);
	});

	test('instance-script accessors (export const / export function) are not props', async () => {
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/Comp.svelte': `<script lang="ts">
	/** Description 1 */
	export const a = 1;
	export function fn(): number {
		return a;
	}
</script>
<div>{a}</div>
`
		});

		const component = findComponent(modules);
		assert.deepStrictEqual(component.props, []);
		// no $props() → no in-script doc slot for the documented accessor either
		assert.strictEqual(component.docComment, undefined);
		assert.deepStrictEqual(diagnostics, []);
	});

	test('accessors beside props stay out of the props', async () => {
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/Comp.svelte': `<script lang="ts">
	export const a = 1;
	export let prop1: string;
	export function fn(): void {}
</script>
<div>{a} {prop1}</div>
`
		});

		assertHasProps(findComponent(modules), ['prop1']);
		assert.deepStrictEqual(diagnostics, []);
	});

	test('accessors stay out of the props of an authored $$Props', async () => {
		// svelte2tsx intersects the accessors into the props type
		// (`{b?: typeof b, fn?: typeof fn} & $$Props`), so with an authored type
		// they're excluded by name rather than by the export allowlist
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/Comp.svelte': `<script lang="ts">
	interface $$Props {
		prop1: string;
		prop2?: number;
	}
	export let prop1: string;
	export const b = 1;
	export function fn(): void {}
	export class C {}
</script>
<div>{prop1} {b}</div>
`
		});

		propsOf(findComponent(modules), ['prop1', 'prop2']);
		assert.deepStrictEqual(diagnostics, []);
	});

	test('an export let name an authored $$Props leaves out is not a prop', async () => {
		// the props are what the type declares: a typed consumer can't pass `prop2`
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/Comp.svelte': `<script lang="ts">
	type $$Props = { prop1: string };
	export let prop1: string;
	export let prop2 = 1;
</script>
<div>{prop1} {prop2}</div>
`
		});

		propsOf(findComponent(modules), ['prop1']);
		assert.deepStrictEqual(diagnostics, []);
	});

	test('a binding exported directly and through a renaming clause keeps the renamed prop', async () => {
		// svelte2tsx's props value drops the direct export in both langs. TS
		// optionality is its type's, which marks the rename optional; JS
		// optionality is the initializer's, and there is none.
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/Comp.svelte': `<script lang="ts">
	export let a: number;
	export { a as b };
</script>
<div>{a}</div>
`,
			'src/lib/Js.svelte': `<script>
	/** @type {number} */
	export let a;
	export { a as b };
</script>
<div>{a}</div>
`
		});

		const [ts_b] = propsOf(findComponent(modules), ['b']);
		assert.strictEqual(ts_b!.type, 'number');
		assert.isTrue(ts_b!.optional);
		const [js_b] = propsOf(findComponent(modules, 'Js'), ['b']);
		assert.strictEqual(js_b!.type, 'number');
		assert.isFalse(js_b!.optional);
		assert.deepStrictEqual(diagnostics, []);
	});

	test('a JS clause below its binding carries the JSDoc; one above it keeps only the type', async () => {
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/Comp.svelte': `<script>
	export { a as prop1 };
	/**
	 * Description 1
	 * @type {string}
	 */
	let a = 'value';
	/**
	 * Description 2
	 * @type {number}
	 */
	let b = 1;
	export { b as prop2 };
</script>
<div>{a} {b}</div>
`
		});

		const [prop1, prop2] = propsOf(findComponent(modules), ['prop1', 'prop2']);
		assert.strictEqual(prop1!.type, 'string');
		assert.strictEqual(prop1!.defaultValue, "'value'");
		// svelte2tsx copies no JSDoc onto a property whose clause it met first
		assert.strictEqual(prop1!.description, undefined);
		assert.strictEqual(prop2!.type, 'number');
		assert.strictEqual(prop2!.description, 'Description 2');
		assert.deepStrictEqual(diagnostics, []);
	});

	test('an export in a script nested in the template is not a prop and not a failure', async () => {
		// a nested `<script>` is an ordinary element, not the instance script,
		// so the scan never reads it
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/Head.svelte': `<svelte:head>
	<script>
		export let a = 1;
	</script>
</svelte:head>
<div>text1</div>
`,
			'src/lib/Nested.svelte': `<div>
	<script>
		export let a = 1;
	</script>
</div>
`
		});

		for (const name of ['Head', 'Nested']) {
			assert.deepStrictEqual(findComponent(modules, name).props, []);
		}
		assert.deepStrictEqual(diagnostics, []);
	});

	test('a nested script ahead of the instance script does not hide its props', async () => {
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/Comp.svelte': `<svelte:head>
	<script>
		export let nested = 1;
	</script>
</svelte:head>
<script lang="ts">
	export let a: string;
</script>
<div>{a}</div>
`
		});
		propsOf(findComponent(modules), ['a']);
		assert.deepStrictEqual(diagnostics, []);
	});

	test('an accessor under an authored $$Props stays out with a nested script first', async () => {
		// the accessors are read from the instance script; read from the nested
		// one instead, `fn` would pass for a prop `$$Props` declares
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/Comp.svelte': `<svelte:head>
	<script>
		export let nested = 1;
	</script>
</svelte:head>
<script lang="ts">
	interface $$Props {
		a: string;
	}
	export let a: string;
	export const fn = (): string => a;
</script>
<div>{a}</div>
`
		});
		propsOf(findComponent(modules), ['a']);
		assert.deepStrictEqual(diagnostics, []);
	});

	test('a component svelte2tsx reads as runes has no legacy props and no diagnostic', async () => {
		// a rune in the script makes svelte2tsx read the component as runes
		// (`bindings: __sveltets_$$bindings('')`): an exported binding there is
		// an instance export, valid in runes mode, and `export let` beside a
		// rune is the compiler's error to report, not a prop to guess at
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/Comp.svelte': `<script lang="ts">
	let a = $state(0);
	let plain = 1;
	export { plain };
</script>
<div>{a} {plain}</div>
`,
			'src/lib/Mixed.svelte': `<script lang="ts">
	export let prop1 = 1;
	let a = $state(0);
</script>
<div>{a} {prop1}</div>
`,
			'src/lib/Js.svelte': `<script>
	export let prop1 = 1;
	let a = $state(0);
</script>
<div>{a} {prop1}</div>
`
		});

		assert.deepStrictEqual(findComponent(modules).props, []);
		for (const name of ['Mixed', 'Js']) {
			assert.deepStrictEqual(findComponent(modules, name).props, []);
		}
		assert.deepStrictEqual(diagnostics, []);
	});

	test('a declared $$Slots default sets acceptsChildren; a named-only one does not', async () => {
		const component = (slots: string): string => `<script lang="ts">
	interface $$Slots {
		${slots}
	}
	export let prop1: string;
</script>
<div>{prop1}</div>
`;
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/Comp.svelte': component('default: { a: number };'),
			'src/lib/Named.svelte': component('b: { a: number };')
		});

		assert.isTrue(findComponent(modules).acceptsChildren);
		assert.isFalse(findComponent(modules, 'Named').acceptsChildren);
		assert.deepStrictEqual(diagnostics, []);
	});

	test('module-script export let is a module export, not a legacy prop', async () => {
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/Comp.svelte': `<script module lang="ts">
	export let a = 1;
</script>
<script lang="ts">
	let { prop1 }: { prop1: string } = $props();
</script>
<div>{prop1} {a}</div>
`
		});

		const [prop] = propsOf(findComponent(modules), ['prop1']);
		// a `$props()` prop is bindable only through `$bindable()`
		assert.isFalse(prop!.bindable);
		assert.deepStrictEqual(diagnostics, []);
	});

	test('an interface $$Props extending an external bag filters like a runes props type', async () => {
		// real `svelte/elements` types, so the ids are rooted in the repo
		const id = join(process.cwd(), 'src/lib/Comp.svelte');
		const { modules, diagnostics } = await analyze({
			sourceFiles: [
				{
					id,
					content: `<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';

	interface $$Props extends HTMLButtonAttributes {
		/** Description 1 */
		prop1: string;
		prop2?: number;
		[key: \`data-\${string}\`]: unknown;
	}

	export let disabled: $$Props['disabled'] = false;
	export let prop1: $$Props['prop1'];
</script>
<button {disabled} {...$$restProps}>{prop1}</button>
`
				}
			],
			sourceOptions: testSourceOptions()
		});

		const component = findComponent(modules);
		// exports first in export order, the external one admitted by name; then
		// what only `$$Props` declares. The rest of the bag and the index
		// signature stay out, summarized by `externalTypes`.
		const [disabled, prop1, prop2] = propsOf(component, ['disabled', 'prop1', 'prop2']);
		assert.strictEqual(disabled!.defaultValue, 'false');
		assert.isTrue(disabled!.optional);
		assert.strictEqual(prop1!.description, 'Description 1');
		assert.isFalse(prop1!.optional);
		assert.isTrue(prop2!.optional);
		assert.isTrue(component.props.every((p) => p.bindable));
		assert.deepStrictEqual(component.externalTypes, ['HTMLButtonAttributes']);
		assert.deepStrictEqual(diagnostics, []);
	});
});

describe('a re-exported legacy component', () => {
	test('a renamed re-export takes the legacy canonical props and default slot', async () => {
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/Comp.svelte': `<script lang="ts">
	/** Description 1 */
	export let a: string;
	export let b = 1;
</script>
<div>{a}{b}<slot /></div>
`,
			'src/lib/barrel.ts': `export { default as Renamed } from './Comp.svelte';\n`
		});
		assert.deepStrictEqual(diagnostics, []);
		const canonical = findComponent(modules);
		const alias = findModule(modules, 'barrel.ts').declarations.find((d) => d.name === 'Renamed');
		assert.ok(alias);
		assert.strictEqual(alias.kind, 'component');
		if (alias.kind !== 'component') throw new Error('not a component');
		assert.deepStrictEqual(alias.aliasOf, { module: 'Comp.svelte', name: 'Comp' });
		assert.deepStrictEqual(alias.props, canonical.props);
		assert.deepStrictEqual(
			alias.props.map(({ name, bindable }) => ({ name, bindable })),
			[
				{ name: 'a', bindable: true },
				{ name: 'b', bindable: true }
			]
		);
		assert.isTrue(alias.acceptsChildren);
	});
});

describe('analyzeFromFiles over legacy and nested-script components', { timeout: 30_000 }, () => {
	test('discovery from disk documents both', async () => {
		await withTestProject(
			{
				'src/lib/Legacy.svelte': `<script lang="ts">
	export let a: string;
	export let b = 1;
</script>
<div>{a}{b}</div>
`,
				'src/lib/Nested.svelte': `<svelte:head>
	<script>
		export let nested = 1;
	</script>
</svelte:head>
<script lang="ts">
	export let a: string;
</script>
<div>{a}</div>
`
			},
			async (projectRoot) => {
				const { modules, diagnostics } = await analyzeFromFiles({ projectRoot });
				assert.deepStrictEqual(diagnostics, []);
				assertHasProps(findComponent(modules, 'Legacy'), ['a', 'b']);
				assertHasProps(findComponent(modules, 'Nested'), ['a']);
			}
		);
	});
});
