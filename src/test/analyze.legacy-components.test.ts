/**
 * Tests for legacy (runes-less) components, which declare props with
 * `export let` instead of `$props()`.
 *
 * The `legacy-*` svelte fixtures lock the extractor's output per shape. These
 * tests cover what a fixture can't pin or states less directly:
 *
 * 1. the syntactic scan (`scanLegacyExports`) — which exports are props, which
 *    are accessors, and what each prop's default is
 * 2. the pipeline's edges — the forms the scan counts, accessors and
 *    module-script exports staying out, the interface form of `$$Props`
 * 3. the refusal — a `$$render` return the anchor doesn't recognize yields no
 *    props and a `svelte_prop_failed` per export, never a guess
 * 4. the doc-walk gate — with no `$props()` anchor the in-script doc slot
 *    doesn't exist, so a documented `export let` (or a documented local in a
 *    propless runes component) can't leak into the component `docComment`;
 *    the HTML `@component` comment is the only source.
 */

import { test, assert, describe } from 'vitest';
import ts from 'typescript';
import { dirname, join } from 'node:path';

import type { ComponentDeclarationJson, ModuleJson } from '#lib/types.ts';
import { analyze } from '#lib/analyze.ts';
import { byKind, type Diagnostic } from '#lib/diagnostics.ts';
import { analyzeSvelteModule, type SvelteVirtualFile } from '#lib/svelte.ts';
import { scanLegacyExports } from '#lib/svelte-legacy.ts';

import { assertHasComponentDeclaration, assertHasProps, findModule } from './test-helpers.ts';
import {
	analyzeTestProject,
	createCachedAnalysisProgram,
	createTestSourceOptions,
	testSourceOptions,
	transformOrThrow
} from './test-module-helpers.ts';

/** The `Comp.svelte` component declaration from an analyze result. */
const compOf = (modules: Array<ModuleJson>): ComponentDeclarationJson =>
	assertHasComponentDeclaration(findModule(modules, 'Comp.svelte'), 'Comp');

/** Assert a component's prop names, in order, and return the props. */
const propsOf = (
	component: ComponentDeclarationJson,
	names: Array<string>
): ComponentDeclarationJson['props'] => {
	assertHasProps(component, names);
	return component.props;
};

/** Parse instance-script content the way `analyzeSvelteModule` does. */
const scan = (script: string) =>
	scanLegacyExports(
		ts.createSourceFile('script.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
	);

/** 1-based line of the first occurrence of `needle` in `source`. */
const lineOf = (source: string, needle: string): number => {
	const index = source.indexOf(needle);
	assert.notStrictEqual(index, -1, `"${needle}" not found`);
	return source.slice(0, index).split('\n').length;
};

describe('scanLegacyExports', () => {
	test('reads props in export order with their defaults', () => {
		const { props, accessors } = scan(`
			export let a: string;
			export let b = 1;
			export let c = undefined;
			export var d = { a: 1 };
		`);
		assert.deepStrictEqual(
			props.map(({ name, hasInitializer, defaultValue }) => ({
				name,
				hasInitializer,
				defaultValue
			})),
			[
				{ name: 'a', hasInitializer: false, defaultValue: undefined },
				{ name: 'b', hasInitializer: true, defaultValue: '1' },
				// an explicit `undefined` is an initializer, but not a default
				{ name: 'c', hasInitializer: true, defaultValue: undefined },
				{ name: 'd', hasInitializer: true, defaultValue: '{ a: 1 }' }
			]
		);
		assert.strictEqual(accessors.size, 0);
	});

	test('an export clause names the prop and carries the binding default', () => {
		const { props } = scan(`
			export { a as class, b };
			let a = 'value';
			let b: number;
		`);
		assert.deepStrictEqual(
			props.map(({ name, defaultValue }) => ({ name, defaultValue })),
			[
				{ name: 'class', defaultValue: "'value'" },
				{ name: 'b', defaultValue: undefined }
			]
		);
	});

	test('const, function, and class exports are accessors; type-only exports are neither', () => {
		const { props, accessors } = scan(`
			type T = number;
			interface I {}
			export const a = 1;
			export function fn() {}
			export class C {}
			const b = 2;
			function fn2() {}
			export { b, fn2 as fn3, I };
			export type { T };
		`);
		assert.deepStrictEqual(props, []);
		assert.deepStrictEqual([...accessors].sort(), ['C', 'a', 'b', 'fn', 'fn3']);
	});
});

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

		const component = compOf(modules);
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

		const component = compOf(modules);
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
		const [prop] = propsOf(compOf(modules), ['prop1']);
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
		const [prop2, prop1] = propsOf(compOf(modules), ['prop2', 'prop1']);
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

		const [prop] = propsOf(compOf(modules), ['prop1']);
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

		const component = compOf(modules);
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

		assertHasProps(compOf(modules), ['prop1']);
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

		propsOf(compOf(modules), ['prop1', 'prop2']);
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

		propsOf(compOf(modules), ['prop1']);
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

		const [ts_b] = propsOf(compOf(modules), ['b']);
		assert.strictEqual(ts_b!.type, 'number');
		assert.isTrue(ts_b!.optional);
		const [js_b] = propsOf(assertHasComponentDeclaration(findModule(modules, 'Js.svelte'), 'Js'), [
			'b'
		]);
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

		const [prop1, prop2] = propsOf(compOf(modules), ['prop1', 'prop2']);
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
			assert.deepStrictEqual(
				assertHasComponentDeclaration(findModule(modules, `${name}.svelte`), name).props,
				[]
			);
		}
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

		assert.deepStrictEqual(compOf(modules).props, []);
		for (const name of ['Mixed', 'Js']) {
			assert.deepStrictEqual(
				assertHasComponentDeclaration(findModule(modules, `${name}.svelte`), name).props,
				[]
			);
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

		assert.isTrue(compOf(modules).acceptsChildren);
		assert.isFalse(
			assertHasComponentDeclaration(findModule(modules, 'Named.svelte'), 'Named').acceptsChildren
		);
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

		const [prop] = propsOf(compOf(modules), ['prop1']);
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

		const component = compOf(modules);
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

describe('legacy props anchor failures', () => {
	// Markup above the script so original and virtual lines can't coincide.
	const SOURCE = `<div>text</div>

<script lang="ts">
	export let a: string;
	export let b = 1;
</script>
`;
	// rooted in the repo so the component's own props aren't judged external
	const ID = join(process.cwd(), 'src/lib/LegacyProbe.svelte');

	/** Analyze `SOURCE` through `analyzeSvelteModule`, with the virtual and checker open to doctoring. */
	const analyzeProbe = (
		doctor: (content: string) => string = (content) => content,
		wrapChecker: (checker: ts.TypeChecker) => ts.TypeChecker = (checker) => checker
	): { component: ComponentDeclarationJson | undefined; failures: Array<Diagnostic> } => {
		const sourceFile = { id: ID, content: SOURCE };
		const transformed = transformOrThrow(sourceFile);
		const virtual = { ...transformed, content: doctor(transformed.content) };
		const program = createCachedAnalysisProgram(new Map([[virtual.virtualPath, virtual]]));
		const diagnostics: Array<Diagnostic> = [];
		const analysis = analyzeSvelteModule(
			sourceFile,
			'LegacyProbe.svelte',
			wrapChecker(program.getTypeChecker()),
			createTestSourceOptions(dirname(ID)),
			diagnostics,
			program,
			virtual
		);
		return {
			component: analysis?.declarations[0]?.declaration as ComponentDeclarationJson | undefined,
			failures: diagnostics
		};
	};

	test('the undoctored probe extracts both props', () => {
		const { component, failures } = analyzeProbe();
		assert.deepStrictEqual(
			component?.props.map((p) => p.name),
			['a', 'b']
		);
		assert.deepStrictEqual(failures, []);
	});

	test('an unrecognized $$render return yields no props and one failure per export', () => {
		// stand-in for a svelte2tsx whose return shape changed: the props value
		// is neither `<object> as <Type>` nor a bare object literal
		const { component, failures } = analyzeProbe((content) => {
			const doctored = content.replace('return { props: ', 'return { props: undefined, was: ');
			assert.notStrictEqual(doctored, content, 'expected the svelte2tsx return to be doctored');
			return doctored;
		});
		assert.strictEqual(component?.props, undefined);
		const propFailures = byKind(failures, 'svelte_prop_failed');
		assert.strictEqual(propFailures.length, failures.length);
		assert.deepStrictEqual(
			propFailures.map(({ propName, line, file, componentName }) => ({
				propName,
				line,
				file,
				componentName
			})),
			[
				{
					propName: 'a',
					line: lineOf(SOURCE, 'export let a'),
					file: ID,
					componentName: 'LegacyProbe'
				},
				{
					propName: 'b',
					line: lineOf(SOURCE, 'export let b'),
					file: ID,
					componentName: 'LegacyProbe'
				}
			]
		);
	});

	test.each([
		['a missing bindings value', 'was: ""'],
		['a bindings value that is neither a string nor a call', 'bindings: 0'],
		['a bindings call to some other function', "bindings: __sveltets_2_any('')"]
	])('%s is no mode reading: no props and one failure per export', (_, replacement) => {
		// stand-ins for a svelte2tsx that stops recording its legacy-or-runes
		// reading the known way: the exports aren't taken for props, and
		// aren't dropped silently as a runes component's would be
		const { component, failures } = analyzeProbe((content) => {
			const doctored = content.replace('bindings: ""', replacement);
			assert.notStrictEqual(doctored, content, 'expected the svelte2tsx return to be doctored');
			return doctored;
		});
		assert.strictEqual(component?.props, undefined);
		assert.deepStrictEqual(
			byKind(failures, 'svelte_prop_failed').map(({ propName, line }) => ({ propName, line })),
			[
				{ propName: 'a', line: lineOf(SOURCE, 'export let a') },
				{ propName: 'b', line: lineOf(SOURCE, 'export let b') }
			]
		);
		assert.strictEqual(failures.length, 2);
	});

	test('a runes bindings call over export let means no props and no failure', () => {
		// the runes arm on its own, with the props value left legacy-shaped:
		// the mode reading decides, not the props type
		const { component, failures } = analyzeProbe((content) => {
			const doctored = content.replace(
				'bindings: ""',
				// a function, since `$$` in a replacement string is an escape
				() => "bindings: __sveltets_$$bindings('')"
			);
			assert.notStrictEqual(doctored, content, 'expected the svelte2tsx return to be doctored');
			return doctored;
		});
		assert.strictEqual(component?.props, undefined);
		assert.deepStrictEqual(failures, []);
	});

	test('a return with no props value is refused, not read as no exports', () => {
		// an empty props value means svelte2tsx saw no exports; an absent one
		// says nothing, so the scanned exports are reported
		const { component, failures } = analyzeProbe((content) => {
			const doctored = content.replace('return { props: ', 'return { was: ');
			assert.notStrictEqual(doctored, content, 'expected the svelte2tsx return to be doctored');
			return doctored;
		});
		assert.strictEqual(component?.props, undefined);
		assert.deepStrictEqual(
			byKind(failures, 'svelte_prop_failed').map((d) => d.propName),
			['a', 'b']
		);
		assert.strictEqual(failures.length, 2);
	});

	test('a written props type that is neither generated nor $$Props is refused', () => {
		// stand-in for a svelte2tsx that names the props type some other way:
		// only a type literal or the reserved `$$Props` is read, so an unknown
		// reference is never taken for an authored type
		const { component, failures } = analyzeProbe((content) => {
			const doctored = content.replace(
				/(return \{ props: \{[^}]*\} as )\{[^}]*\}/,
				'$1Partial<{a: string, b: number}>'
			);
			assert.notStrictEqual(doctored, content, 'expected the svelte2tsx return to be doctored');
			return doctored;
		});
		assert.strictEqual(component?.props, undefined);
		assert.deepStrictEqual(
			byKind(failures, 'svelte_prop_failed').map((d) => d.propName),
			['a', 'b']
		);
		assert.strictEqual(failures.length, 2);
	});

	test('a prop whose type throws falls back to any with no position', () => {
		// the props type literal is text svelte2tsx appends, which maps to
		// nothing in the original source: absence over a virtual line
		const { component, failures } = analyzeProbe(
			undefined,
			(checker) =>
				new Proxy(checker, {
					get(target, key, receiver) {
						if (key === 'getTypeOfSymbolAtLocation') {
							return (symbol: ts.Symbol, node: ts.Node) => {
								if (symbol.name === 'a') throw new Error('synthetic resolution failure');
								return target.getTypeOfSymbolAtLocation(symbol, node);
							};
						}
						const value = Reflect.get(target, key, receiver);
						return typeof value === 'function' ? value.bind(target) : value;
					}
				})
		);
		assert.deepStrictEqual(
			component?.props.map(({ name, type }) => ({ name, type })),
			[
				{ name: 'a', type: 'any' },
				{ name: 'b', type: 'number' }
			]
		);
		const propFailures = byKind(failures, 'svelte_prop_failed');
		assert.strictEqual(propFailures.length, 1);
		assert.strictEqual(propFailures[0]!.propName, 'a');
		assert.strictEqual(propFailures[0]!.line, undefined);
		assert.strictEqual(propFailures[0]!.column, undefined);
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

describe('legacy render classification', () => {
	const SOURCE = `<div><slot /></div>\n`;
	const ID = join(process.cwd(), 'src/lib/LegacyRenderProbe.svelte');

	const analyzeProbe = (
		doctor: (content: string) => string = (content) => content
	): ComponentDeclarationJson | undefined => {
		const sourceFile = { id: ID, content: SOURCE };
		const transformed = transformOrThrow(sourceFile);
		const virtual = { ...transformed, content: doctor(transformed.content) };
		const program = createCachedAnalysisProgram(new Map([[virtual.virtualPath, virtual]]));
		const diagnostics: Array<Diagnostic> = [];
		const analysis = analyzeSvelteModule(
			sourceFile,
			'LegacyRenderProbe.svelte',
			program.getTypeChecker(),
			createTestSourceOptions(dirname(ID)),
			diagnostics,
			program,
			virtual
		);
		assert.deepStrictEqual(diagnostics, []);
		return analysis?.declarations[0]?.declaration as ComponentDeclarationJson | undefined;
	};

	test('the undoctored probe reads its default slot', () => {
		assert.isTrue(analyzeProbe()?.acceptsChildren);
	});

	test('a return with no bindings value is not read as legacy', () => {
		// stand-in for a svelte2tsx that stops writing `bindings`: with no
		// legacy-or-runes reading the slot is ignored rather than guessed at
		const component = analyzeProbe((content) => {
			const doctored = content.replace('bindings: ""', 'was: ""');
			assert.notStrictEqual(doctored, content, 'expected the svelte2tsx return to be doctored');
			return doctored;
		});
		assert.ok(component);
		assert.isNotTrue(component.acceptsChildren);
	});
});

describe('legacy empty props value', () => {
	// The scan reads exports svelte2tsx doesn't: Svelte's parser, and so
	// `findScriptTags`, take a closing tag with whitespace before its `>`,
	// while svelte2tsx's own tag matcher skips the whole script and writes an
	// empty props value.
	const SOURCE = `<script>
	export let a = 1;
</script >
<div>text1</div>
`;
	const TS_SOURCE = SOURCE.replace('<script>', '<script lang="ts">');
	const ID = join(process.cwd(), 'src/lib/LegacyEmptyValueProbe.svelte');

	const analyzeProbe = (
		doctor: (content: string) => string = (content) => content,
		source = SOURCE
	): { component: ComponentDeclarationJson | undefined; failures: Array<Diagnostic> } => {
		const sourceFile = { id: ID, content: source };
		const transformed = transformOrThrow(sourceFile);
		// the premise: the scan has an export to read
		assert.include(transformed.scriptTags?.[0]?.content, 'export let a');
		const virtual = { ...transformed, content: doctor(transformed.content) };
		const program = createCachedAnalysisProgram(new Map([[virtual.virtualPath, virtual]]));
		const diagnostics: Array<Diagnostic> = [];
		const analysis = analyzeSvelteModule(
			sourceFile,
			'LegacyEmptyValueProbe.svelte',
			program.getTypeChecker(),
			createTestSourceOptions(dirname(ID)),
			diagnostics,
			program,
			virtual
		);
		return {
			component: analysis?.declarations[0]?.declaration as ComponentDeclarationJson | undefined,
			failures: diagnostics
		};
	};

	test('the undoctored probe has an empty props value: no props and no failure', () => {
		const { component, failures } = analyzeProbe();
		assert.strictEqual(component?.props, undefined);
		assert.deepStrictEqual(failures, []);
	});

	test('an empty props value under an unrecognized mode is refused, not read as no exports', () => {
		// with no mode reading nothing says svelte2tsx saw a legacy component,
		// so its empty props value doesn't overrule the scan
		const { component, failures } = analyzeProbe((content) => {
			const doctored = content.replace('bindings: ""', 'was: ""');
			assert.notStrictEqual(doctored, content, 'expected the svelte2tsx return to be doctored');
			return doctored;
		});
		assert.strictEqual(component?.props, undefined);
		assert.deepStrictEqual(
			byKind(failures, 'svelte_prop_failed').map((d) => d.propName),
			['a']
		);
		assert.strictEqual(failures.length, 1);
	});

	test('the TS form of the empty value has no props and no failure', () => {
		// `{} as Record<string, never>`, where the JS form is a JSDoc cast
		const { component, failures } = analyzeProbe((content) => {
			assert.include(content, '{} as Record<string, never>');
			return content;
		}, TS_SOURCE);
		assert.strictEqual(component?.props, undefined);
		assert.deepStrictEqual(failures, []);
	});
});

describe('legacy props beside a nested script', () => {
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
		propsOf(compOf(modules), ['a']);
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
		propsOf(compOf(modules), ['a']);
		assert.deepStrictEqual(diagnostics, []);
	});
});

describe('script tags on the virtual', () => {
	const SOURCE = `<script lang="ts">
	export let a: string;
</script>
<div>{a}</div>
`;
	const ID = join(process.cwd(), 'src/lib/LegacyScriptTagsProbe.svelte');

	const analyzeProbe = (
		doctor: (virtual: SvelteVirtualFile) => SvelteVirtualFile
	): ComponentDeclarationJson | undefined => {
		const sourceFile = { id: ID, content: SOURCE };
		const virtual = doctor(transformOrThrow(sourceFile));
		const program = createCachedAnalysisProgram(new Map([[virtual.virtualPath, virtual]]));
		const analysis = analyzeSvelteModule(
			sourceFile,
			'LegacyScriptTagsProbe.svelte',
			program.getTypeChecker(),
			createTestSourceOptions(dirname(ID)),
			[],
			program,
			virtual
		);
		return analysis?.declarations[0]?.declaration as ComponentDeclarationJson | undefined;
	};

	test('analysis reads the tags the virtual carries, without locating them again', () => {
		// a virtual that says the component has no script: the source's
		// `export let` is never scanned
		assert.strictEqual(
			analyzeProbe((virtual) => ({ ...virtual, scriptTags: [] }))?.props,
			undefined
		);
	});

	test('a virtual that carries none has them located in the source', () => {
		const component = analyzeProbe(({ scriptTags: _, ...virtual }) => virtual);
		assert.ok(component);
		propsOf(component, ['a']);
	});
});
