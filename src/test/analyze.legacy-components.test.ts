/**
 * Tests for legacy (runes-less) component detection.
 *
 * Legacy `export let` components are still-legal Svelte 5 syntax, but prop
 * extraction anchors on the `$props()` declaration, so their props are not
 * extracted. Two behaviors are locked here:
 *
 * 1. the `legacy_props` diagnostic — emitted when the instance script
 *    declares props via legacy syntax (`export let`/`export var`, or an
 *    export clause renaming a mutable binding) and no `$props()` exists.
 *    Detection is syntactic, not mode classification: `export let` is a
 *    compile error in runes mode, so its presence is a reliable signal.
 * 2. the doc-walk gate — with no `$props()` anchor the in-script doc slot
 *    doesn't exist, so a documented `export let` (or a documented local in a
 *    propless runes component) can't leak into the component `docComment`;
 *    the HTML `@component` comment is the only source.
 *
 * The `svelte/component/legacy-export-let` fixture locks the extractor
 * output; these tests cover the full `analyze` pipeline (diagnostic shape,
 * line mapping, non-prop exports staying silent).
 */

import { test, assert, describe } from 'vitest';

import type { ComponentDeclarationJson, ModuleJson } from '$lib/types.ts';
import { byKind } from '$lib/diagnostics.ts';

import { assertHasComponentDeclaration, assertHasProps, findModule } from './test-helpers.ts';
import { analyzeTestProject } from './test-module-helpers.ts';

/** The `Comp.svelte` component declaration from an analyze result. */
const compOf = (modules: Array<ModuleJson>): ComponentDeclarationJson =>
	assertHasComponentDeclaration(findModule(modules, 'Comp.svelte'), 'Comp');

describe('legacy export let components', () => {
	test('emits legacy_props with prop names and source line, extracts zero props', async () => {
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/Comp.svelte': `<script lang="ts">
	/** Description 1 */
	export let prop1: string;
	export let prop2 = 1;
</script>
<div>{prop1} {prop2}</div>
`
		});

		const component = compOf(modules);
		assert.deepStrictEqual(component.props, []);
		// the documented export let must not leak into the component doc
		assert.strictEqual(component.docComment, undefined);

		assert.strictEqual(diagnostics.length, 1);
		const [diagnostic] = byKind(diagnostics, 'legacy_props');
		assert.ok(diagnostic, 'expected a legacy_props diagnostic');
		assert.strictEqual(diagnostic.severity, 'warning');
		assert.strictEqual(diagnostic.componentName, 'Comp');
		assert.deepStrictEqual(diagnostic.propNames, ['prop1', 'prop2']);
		// `export let prop1` sits on line 3 of the original source
		assert.strictEqual(diagnostic.line, 3);
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

		const component = compOf(modules);
		assert.strictEqual(component.docComment, 'Description.');
		// the script slot stayed empty, so no script-vs-html duplicate warning
		assert.deepStrictEqual(
			diagnostics.map((d) => d.kind),
			['legacy_props']
		);
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

		assert.deepStrictEqual(compOf(modules).props, []);
		const legacy = byKind(diagnostics, 'legacy_props');
		assert.strictEqual(legacy.length, 1);
		// exported name, not the local binding; `b` (const) and `T` excluded
		assert.deepStrictEqual(legacy[0]!.propNames, ['prop1']);
	});

	test('export var, clause preceding its binding, and dual export all count', async () => {
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/Comp.svelte': `<script lang="ts">
	export var prop1 = 1;
	export { a as prop2, prop1 as prop3 };
	let a = true;
</script>
<div>{prop1} {a}</div>
`
		});

		assert.deepStrictEqual(compOf(modules).props, []);
		const legacy = byKind(diagnostics, 'legacy_props');
		assert.strictEqual(legacy.length, 1);
		// source order: the export var name precedes both clause specifiers; the
		// clause resolves `a` declared below it and re-exports the exported prop1
		assert.deepStrictEqual(legacy[0]!.propNames, ['prop1', 'prop2', 'prop3']);
		assert.strictEqual(legacy[0]!.line, 2);
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

		const component = compOf(modules);
		assert.deepStrictEqual(component.props, []);
		// no $props() → no in-script doc slot for the documented accessor either
		assert.strictEqual(component.docComment, undefined);
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

		assertHasProps(compOf(modules), ['prop1']);
		assert.deepStrictEqual(diagnostics, []);
	});
});

describe('propless runes components', () => {
	test('a documented local cannot claim the component doc slot', async () => {
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/Comp.svelte': `<script lang="ts">
	/** Description 1 */
	let a = $state(0);
</script>
<div>{a}</div>
`
		});

		const component = compOf(modules);
		assert.strictEqual(component.docComment, undefined);
		assert.deepStrictEqual(component.props, []);
		assert.deepStrictEqual(diagnostics, []);
	});

	test('the HTML @component comment still documents an anchorless component', async () => {
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/Comp.svelte': `<!--
@component
Description.
-->
<script lang="ts">
	/** Description 1 */
	let a = $state(0);
</script>
<div>{a}</div>
`
		});

		assert.strictEqual(compOf(modules).docComment, 'Description.');
		assert.deepStrictEqual(diagnostics, []);
	});
});
