/**
 * Tests for what a legacy component's props are refused over: a svelte2tsx
 * virtual that doesn't say what the analyzer needs yields no props and a
 * `svelte_prop_failed` per export, never a guess.
 *
 * Most of these shapes are ones svelte2tsx doesn't write, so the virtual is
 * doctored (`analyzeDoctored`) to stand in for a version that does:
 *
 * 1. the props anchor — a `$$render` return whose `props` value or written
 *    type isn't recognized
 * 2. the mode reading — a `bindings` value that says neither legacy nor runes,
 *    for the props and for the default slot
 * 3. exports svelte2tsx didn't read — the one refusal a real source reaches
 *
 * What a recognized legacy component documents is in
 * `analyze.legacy-components.test.ts`.
 */

import { test, assert, describe } from 'vitest';
import type ts from 'typescript';

import { byKind } from '#lib/diagnostics.ts';

import { findComponent, lineOf } from './test-helpers.ts';
import {
	analyzeDoctored,
	analyzeTestProject,
	type DoctoredAnalysis
} from './test-module-helpers.ts';

/**
 * Assert no props, and one `svelte_prop_failed` per name and nothing else,
 * each at its `export let` line in `source`.
 */
const assertRefused = (
	{ component, diagnostics, id }: DoctoredAnalysis,
	source: string,
	propNames: Array<string>
): void => {
	assert.ok(component);
	assert.strictEqual(component.props, undefined);
	const failures = byKind(diagnostics, 'svelte_prop_failed');
	assert.strictEqual(failures.length, diagnostics.length);
	assert.deepStrictEqual(
		failures.map(({ propName, line, file, componentName }) => ({
			propName,
			line,
			file,
			componentName
		})),
		propNames.map((propName) => ({
			propName,
			line: lineOf(source, `export let ${propName}`),
			file: id,
			componentName: component.name
		}))
	);
};

describe('legacy props anchor failures', () => {
	// Markup above the script so original and virtual lines can't coincide.
	const SOURCE = `<div>text</div>

<script lang="ts">
	export let a: string;
	export let b = 1;
</script>
`;

	/** Analyze `SOURCE` with the virtual's content doctored. */
	const analyzeProbe = (content?: (content: string) => string): DoctoredAnalysis =>
		analyzeDoctored('LegacyProbe', SOURCE, { content });

	/** Replace the written props type svelte2tsx generated for `SOURCE`. */
	const withPropsType =
		(type: string) =>
		(content: string): string =>
			content.replace(/(return \{ props: \{[^}]*\} as )\{[^}]*\}/, `$1${type}`);

	test('the undoctored probe extracts both props', () => {
		const { component, diagnostics } = analyzeProbe();
		assert.deepStrictEqual(
			component?.props.map((p) => p.name),
			['a', 'b']
		);
		assert.deepStrictEqual(diagnostics, []);
	});

	test('an unrecognized $$render return yields no props and one failure per export', () => {
		// stand-in for a svelte2tsx whose return shape changed: the props value
		// is neither `<object> as <Type>` nor a bare object literal
		const result = analyzeProbe((content) =>
			content.replace('return { props: ', 'return { props: undefined, was: ')
		);
		assertRefused(result, SOURCE, ['a', 'b']);
	});

	test.each([
		['a missing bindings value', 'was: ""'],
		['a bindings value that is neither a string nor a call', 'bindings: 0'],
		['a bindings call to some other function', "bindings: __sveltets_2_any('')"]
	])('%s is no mode reading: no props and one failure per export', (_, replacement) => {
		// stand-ins for a svelte2tsx that stops recording its legacy-or-runes
		// reading the known way: the exports aren't taken for props, and
		// aren't dropped silently as a runes component's would be
		const result = analyzeProbe((content) => content.replace('bindings: ""', replacement));
		assertRefused(result, SOURCE, ['a', 'b']);
	});

	test('a runes bindings call over export let means no props and no failure', () => {
		// the runes arm on its own, with the props value left legacy-shaped:
		// the mode reading decides, not the props type
		const { component, diagnostics } = analyzeProbe((content) =>
			content.replace(
				'bindings: ""',
				// a function, since `$$` in a replacement string is an escape
				() => "bindings: __sveltets_$$bindings('')"
			)
		);
		assert.strictEqual(component?.props, undefined);
		assert.deepStrictEqual(diagnostics, []);
	});

	test('a return with no props value is refused', () => {
		// nothing to read a type from, so the scanned exports are reported
		const result = analyzeProbe((content) => content.replace('return { props: ', 'return { was: '));
		assertRefused(result, SOURCE, ['a', 'b']);
	});

	test('a written props type that is neither generated nor $$Props is refused', () => {
		// stand-in for a svelte2tsx that names the props type some other way:
		// only a type literal or the reserved `$$Props` is read, so an unknown
		// reference is never taken for an authored type
		const result = analyzeProbe(withPropsType('Partial<{a: string, b: number}>'));
		assertRefused(result, SOURCE, ['a', 'b']);
	});

	test('an intersection of literals with no $$Props is not an authored type', () => {
		// stand-in for a svelte2tsx that splits its generated literal: without
		// the reserved alias nothing says the type is the author's
		const result = analyzeProbe(withPropsType('{a: string} & {b?: number}'));
		assertRefused(result, SOURCE, ['a', 'b']);
	});

	test('a $$Props intersected with anything but a literal is refused', () => {
		const source = `<script lang="ts">
	type Extra = { z?: number };
	interface $$Props {
		a: string;
	}
	export let a: string;
	export const fn = (): string => a;
</script>
`;
		const result = analyzeDoctored('LegacyPropsIntersectionProbe', source, {
			// a function, since `$$` in a replacement string is an escape
			content: (content) =>
				content.replace('} & $$Props, exports', () => '} & $$Props & Extra, exports')
		});
		assertRefused(result, source, ['a']);
	});

	test('a prop whose type throws falls back to any with no position', () => {
		// the props type literal is text svelte2tsx appends, which maps to
		// nothing in the original source: absence over a virtual line
		const { component, diagnostics } = analyzeDoctored('LegacyProbe', SOURCE, {
			checker: (checker) =>
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
		});
		assert.deepStrictEqual(
			component?.props.map(({ name, type }) => ({ name, type })),
			[
				{ name: 'a', type: 'any' },
				{ name: 'b', type: 'number' }
			]
		);
		const failures = byKind(diagnostics, 'svelte_prop_failed');
		assert.strictEqual(failures.length, 1);
		assert.strictEqual(failures[0]!.propName, 'a');
		assert.strictEqual(failures[0]!.line, undefined);
		assert.strictEqual(failures[0]!.column, undefined);
	});
});

describe('legacy render classification', () => {
	const SOURCE = `<div><slot /></div>\n`;

	test('the undoctored probe reads its default slot', () => {
		const { component, diagnostics } = analyzeDoctored('LegacyRenderProbe', SOURCE);
		assert.isTrue(component?.acceptsChildren);
		assert.deepStrictEqual(diagnostics, []);
	});

	test('a return with no bindings value is not read as legacy', () => {
		// stand-in for a svelte2tsx that stops writing `bindings`: with no
		// legacy-or-runes reading the slot is ignored rather than guessed at
		const { component, diagnostics } = analyzeDoctored('LegacyRenderProbe', SOURCE, {
			content: (content) => content.replace('bindings: ""', 'was: ""')
		});
		assert.ok(component);
		assert.isNotTrue(component.acceptsChildren);
		assert.deepStrictEqual(diagnostics, []);
	});
});

describe('legacy exports svelte2tsx did not read', () => {
	// The scan reads exports svelte2tsx doesn't: Svelte's parser, and so
	// `findScriptTags`, take a closing tag with whitespace before its `>`,
	// while svelte2tsx's own tag matcher skips the whole script and writes an
	// empty props value. Markup above the script so original and virtual lines
	// can't coincide.
	const SOURCE = `<div>text1</div>

<script>
	export let a = 1;
	/** @type {string} */
	export let b;
</script >
`;
	const TS_SOURCE = `<div>text1</div>

<script lang="ts">
	export let a = 1;
	export let b: string;
</script >
`;
	// the JS form of the empty value is a JSDoc cast on `({})`
	const EMPTY_VALUE = '/** @type {Record<string, never>} */ ({})';
	const TS_EMPTY_VALUE = '{} as Record<string, never>';

	/** Analyze `source`, asserting the premise: the scan has exports to read, and svelte2tsx found none. */
	const analyzeProbe = (
		source: string,
		emptyValue: string,
		content?: (content: string) => string
	): DoctoredAnalysis => {
		const result = analyzeDoctored('LegacyUnreadProbe', source, { content });
		assert.include(result.transformed.scriptTags?.[0]?.content, 'export let a');
		assert.include(result.transformed.content, `props: ${emptyValue}`);
		return result;
	};

	test('an untyped component yields no props and one failure per export', () => {
		const result = analyzeProbe(SOURCE, EMPTY_VALUE);
		assertRefused(result, SOURCE, ['a', 'b']);
		// the message names the cause a user can act on
		assert.include(result.diagnostics[0]!.message, '</script >');
	});

	test('a typed component yields no props and one failure per export', () => {
		assertRefused(analyzeProbe(TS_SOURCE, TS_EMPTY_VALUE), TS_SOURCE, ['a', 'b']);
	});

	test('an unrecognized mode refuses the same way', () => {
		const result = analyzeProbe(SOURCE, EMPTY_VALUE, (content) =>
			content.replace('bindings: ""', 'was: ""')
		);
		assertRefused(result, SOURCE, ['a', 'b']);
	});

	test('a runes component closed the same way has no props and no failure', async () => {
		// svelte2tsx reads no script, so there's no `$props()` to anchor on, and
		// the scan finds no `export let` to report
		const { modules, diagnostics } = await analyzeTestProject({
			'src/lib/Comp.svelte': `<script lang="ts">
	let { a }: { a: string } = $props();
</script >
<div>{a}</div>
`
		});
		assert.deepStrictEqual(findComponent(modules).props, []);
		assert.deepStrictEqual(diagnostics, []);
	});
});
