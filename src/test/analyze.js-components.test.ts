/**
 * Tests for JS-only (no `lang="ts"`) component extraction.
 *
 * JS components carry their props type as JSDoc — an author-written
 * `@type {A}` over the `$props()` destructuring, or the `$$ComponentProps`
 * typedef svelte2tsx synthesizes when there's no annotation. Extraction
 * depends on two pieces working together: the virtual parsing with
 * `ScriptKind.JS` (so the checker reads JSDoc types) and the props anchor
 * falling back to `ts.getJSDocType` when the declaration has no TypeNode.
 *
 * Doc precedence is exercised too: a tags-only `@type`/`@typedef` block is
 * type machinery, not documentation, so it must not claim the component doc
 * slot — the HTML `@component` comment stays reachable as the fallback.
 *
 * The `svelte/props/jsdoc-type` and `svelte/component/javascript` fixtures
 * lock the extractor output; these tests cover the full `analyze` pipeline
 * (cross-file JSDoc imports, diagnostics) and the session's script-kind
 * handling when a component flips `lang` in place.
 */

import { test, assert, describe } from 'vitest';
import { join } from 'node:path';

import { createAnalysisSession } from '$lib/session.ts';
import { createSourceOptions } from '$lib/source-config.ts';
import type { ComponentDeclarationJson, ModuleJson } from '$lib/types.ts';

import { assertHasComponentDeclaration, findModule, withTestProject } from './test-helpers.ts';
import { analyzeTestProject } from './test-module-helpers.ts';

/** The `Comp.svelte` component declaration from an analyze result. */
const compOf = (modules: Array<ModuleJson>): ComponentDeclarationJson =>
	assertHasComponentDeclaration(findModule(modules, 'Comp.svelte'), 'Comp');

/** Comparison projection over props: the fields these tests assert. */
const propShapes = (
	component: ComponentDeclarationJson
): Array<{ name: string; type: string; optional: boolean }> =>
	component.props.map((p) => ({ name: p.name, type: p.type, optional: p.optional }));

describe('JS component props via JSDoc @type', () => {
	test('extracts typed props including a cross-file JSDoc import', async () => {
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/a.ts': `export type A = 'a' | 'b';\n`,
			'src/lib/Comp.svelte': `<script>
	/**
	 * @typedef {Object} B
	 * @property {boolean} [prop1] Description 1
	 * @property {string} prop2 Description 2
	 * @property {import('./a').A} [prop3] Description 3
	 */

	/** @type {B} */
	let { prop1 = true, prop2, prop3 = 'a' } = $props();
</script>
<div>{prop2}</div>
`
		});

		assert.deepStrictEqual(diagnostics, []);
		const component = compOf(modules);
		assert.strictEqual(component.lang, 'js');
		assert.deepStrictEqual(
			component.props.map((p) => ({
				name: p.name,
				type: p.type,
				optional: p.optional,
				description: p.description,
				defaultValue: p.defaultValue
			})),
			[
				{
					name: 'prop1',
					type: 'boolean',
					optional: true,
					description: 'Description 1',
					defaultValue: 'true'
				},
				{
					name: 'prop2',
					type: 'string',
					optional: false,
					description: 'Description 2',
					defaultValue: undefined
				},
				{
					name: 'prop3',
					type: 'A',
					optional: true,
					description: 'Description 3',
					defaultValue: "'a'"
				}
			]
		);
	});

	test('extracts untyped props from the svelte2tsx-synthesized typedef', async () => {
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/Comp.svelte': `<script>
	let { prop1 = true, prop2 } = $props();
</script>
<div>{prop2}</div>
`
		});

		assert.deepStrictEqual(diagnostics, []);
		const component = compOf(modules);
		assert.strictEqual(component.lang, 'js');
		assert.deepStrictEqual(propShapes(component), [
			// svelte2tsx infers `boolean` from the default and marks it optional
			{ name: 'prop1', type: 'boolean', optional: true },
			{ name: 'prop2', type: 'any', optional: false }
		]);
	});

	test('a stray JSDoc @type on a TS component is ignored', async () => {
		// The `ts.getJSDocType` fallback never fires for TS virtuals:
		// svelte2tsx synthesizes a real annotation (`$$ComponentProps`, all
		// props `any`) even for untyped `$props()`, and the anchor prefers
		// `.type` — even though the JSDoc reference here would resolve to
		// `{prop1: string}` if consulted.
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/Comp.svelte': `<script lang="ts">
	type A = { prop1: string };
	/** @type {A} */
	let { prop1 } = $props();
</script>
<div>{prop1}</div>
`
		});

		assert.deepStrictEqual(diagnostics, []);
		const component = compOf(modules);
		assert.strictEqual(component.lang, undefined);
		assert.deepStrictEqual(propShapes(component), [
			{ name: 'prop1', type: 'any', optional: false }
		]);
	});

	test('an unresolvable @type reference extracts zero props without failing', async () => {
		// JS twin of the TS-side `MissingType` test (svelte.test.ts): the
		// checker resolves the reference to its error type — no properties,
		// no crash. Analysis completing is the lock; like the TS side, no
		// assertion on diagnostics (checker-behavior dependent).
		const { modules } = await analyzeTestProject({
			'src/lib/Comp.svelte': `<script>
	/** @type {Missing} */
	let { prop1 } = $props();
</script>
<div>{prop1}</div>
`
		});

		const component = compOf(modules);
		assert.strictEqual(component.lang, 'js');
		assert.deepStrictEqual(component.props, []);
	});
});

describe('JS component doc precedence', () => {
	test('HTML @component doc survives the @type annotation', async () => {
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/Comp.svelte': `<!--
@component
Description.
-->
<script>
	/**
	 * @typedef {Object} A
	 * @property {string} prop1
	 */

	/** @type {A} */
	let { prop1 } = $props();
</script>
<div>{prop1}</div>
`
		});

		const component = compOf(modules);
		assert.strictEqual(component.docComment, 'Description.');
		// type machinery claiming nothing means no script-vs-html duplicate either
		assert.deepStrictEqual(diagnostics, []);
	});

	test('a described @type block (typedef reference) wins over the HTML comment and warns', async () => {
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/Comp.svelte': `<!--
@component
Description 2.
-->
<script>
	/**
	 * @typedef {Object} A
	 * @property {string} prop1
	 */

	/**
	 * Description 1.
	 * @type {A}
	 */
	let { prop1 } = $props();
</script>
<div>{prop1}</div>
`
		});

		const component = compOf(modules);
		assert.strictEqual(component.docComment, 'Description 1.');
		assert.strictEqual(diagnostics.length, 1);
		assert.strictEqual(diagnostics[0]!.kind, 'duplicate_comment');
	});

	test('a described inline @type literal falls back to the HTML comment', async () => {
		// svelte2tsx rewrites `@type {{...}}` object literals into a synthesized
		// `@typedef` + `@type {$$ComponentProps}` pair, relocating the author's
		// description into the typedef block — which the AST never attaches to
		// the `$props()` statement. The description is unreachable, but the
		// synthesized machinery block must not mask the HTML fallback.
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/Comp.svelte': `<!--
@component
Description 2.
-->
<script>
	/**
	 * Description 1.
	 * @type {{prop1: string}}
	 */
	let { prop1 } = $props();
</script>
<div>{prop1}</div>
`
		});

		const component = compOf(modules);
		assert.strictEqual(component.docComment, 'Description 2.');
		assert.deepStrictEqual(diagnostics, []);
		// the rewritten typedef still types the props
		assert.deepStrictEqual(propShapes(component), [
			{ name: 'prop1', type: 'string', optional: false }
		]);
	});

	test('@nodocs above $props() excludes the component', async () => {
		const { modules } = await analyzeTestProject({
			'src/lib/Comp.svelte': `<script>
	/** @nodocs */
	let { prop1 } = $props();
</script>
<div>{prop1}</div>
`
		});

		assert.deepStrictEqual(findModule(modules, 'Comp.svelte').declarations, []);
	});
});

describe('JS <script module> exports', () => {
	test('module-script declarations extract with inferred types under the JS parse', async () => {
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/Comp.svelte': `<script module>
	/** Description 1. */
	export const a = 1;
</script>
<script>
	let { prop1 } = $props();
</script>
<div>{prop1}</div>
`
		});

		assert.deepStrictEqual(diagnostics, []);
		const variable = findModule(modules, 'Comp.svelte').declarations.find((d) => d.name === 'a');
		assert.ok(variable, 'expected the module-script export');
		assert.strictEqual(variable.kind, 'variable');
		assert.strictEqual(variable.docComment, 'Description 1.');
		assert.strictEqual(variable.typeSignature, '1');
	});
});

describe('script lang detection', () => {
	test('a JS component stays JS when its template mentions lang="ts"', async () => {
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/Comp.svelte': `<script>
	/** @type {{ label: string }} */
	let { label } = $props();
</script>
<pre>{'<script lang="ts">'}</pre>
<div>{label}</div>
`
		});

		// a whole-file text scan would flip this component to ScriptKind.TS,
		// silently discarding the JSDoc prop type
		assert.deepStrictEqual(diagnostics, []);
		const component = compOf(modules);
		assert.strictEqual(component.lang, 'js');
		assert.deepStrictEqual(propShapes(component), [
			{ name: 'label', type: 'string', optional: false }
		]);
	});

	test('lang="typescript" is recognized as TS', async () => {
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/Comp.svelte': `<script lang="typescript">
	let { label }: { label: string } = $props();
</script>
<div>{label}</div>
`
		});

		assert.deepStrictEqual(diagnostics, []);
		const component = compOf(modules);
		assert.strictEqual(component.lang, undefined);
		assert.deepStrictEqual(propShapes(component), [
			{ name: 'label', type: 'string', optional: false }
		]);
	});
});

describe('session script-kind handling', () => {
	test('a component flipping lang in place re-extracts under the new kind', async () => {
		const TS_VERSION = `<script lang="ts">
	let { prop1 }: { prop1: string } = $props();
</script>
<div>{prop1}</div>
`;
		const JS_VERSION = `<script>
	/**
	 * @typedef {Object} A
	 * @property {number} [prop1]
	 */

	/** @type {A} */
	let { prop1 = 1 } = $props();
</script>
<div>{prop1}</div>
`;

		// the project supplies only tsconfig.json — the session takes content
		// directly and never reads the `.svelte` from disk
		await withTestProject({}, async (projectRoot) => {
			const id = join(projectRoot, 'src/lib/Comp.svelte');
			const session = createAnalysisSession({
				sourceOptions: createSourceOptions(projectRoot)
			});
			try {
				await session.setFiles([{ id, content: TS_VERSION }]);
				const first = compOf(session.query().modules);
				assert.strictEqual(first.lang, undefined);
				assert.deepStrictEqual(propShapes(first), [
					{ name: 'prop1', type: 'string', optional: false }
				]);

				// ts → js: same virtual path, new script kind — the LS must reparse
				// so the JSDoc type participates in checking
				await session.setFile({ id, content: JS_VERSION });
				const second = compOf(session.query().modules);
				assert.strictEqual(second.lang, 'js');
				assert.deepStrictEqual(propShapes(second), [
					{ name: 'prop1', type: 'number', optional: true }
				]);

				// js → ts: back again
				await session.setFile({ id, content: TS_VERSION });
				const third = compOf(session.query().modules);
				assert.strictEqual(third.lang, undefined);
				assert.deepStrictEqual(propShapes(third), [
					{ name: 'prop1', type: 'string', optional: false }
				]);
			} finally {
				session.dispose();
			}
		});
	});
});
