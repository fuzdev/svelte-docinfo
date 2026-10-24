/**
 * Tests for reading a component's styling API (`svelte-css.ts`): the `var()`
 * scanner over CSS text, and `analyzeComponentCss` over whole components,
 * for the edges the fixtures can't hold (sources Svelte rejects) or that are
 * clearer one at a time.
 */

import { test, assert, describe } from 'vitest';

import {
	analyzeComponentCss,
	documentCssProperties,
	findCsspropTagLine,
	scanCssVarReads
} from '#lib/svelte-css.ts';

/** `[name, fallback]` pairs of the reads `scanCssVarReads` returns. */
const readsOf = (text: string) =>
	scanCssVarReads(text).map((read) => [read.name, read.fallback] as const);

/** `[name, fallback, sourceLine]` triples of a component's styling API. */
const propertiesOf = (source: string) =>
	analyzeComponentCss(source).properties.map(
		(property) => [property.name, property.fallback, property.sourceLine] as const
	);

describe('scanCssVarReads', () => {
	test('reads names and fallbacks, trimmed', () => {
		assert.deepEqual(readsOf('var(--a)'), [['--a', undefined]]);
		assert.deepEqual(readsOf('var( --a , 1px  2px )'), [['--a', '1px  2px']]);
		assert.deepEqual(readsOf('var(--a,)'), [['--a', '']]);
	});

	test('reads only the outermost var()', () => {
		assert.deepEqual(readsOf('var(--a, var(--b, var(--c)))'), [['--a', 'var(--b, var(--c))']]);
		assert.deepEqual(readsOf('calc(var(--a, 1px) + var(--b))'), [
			['--a', '1px'],
			['--b', undefined]
		]);
	});

	test('matches the function name case-insensitively, as a whole identifier', () => {
		assert.deepEqual(readsOf('VAR(--a, 1) Var(--b, 2)'), [
			['--a', '1'],
			['--b', '2']
		]);
		assert.deepEqual(readsOf('-var(--a, 1) xvar(--b, 2) my-var(--c, 3)'), []);
	});

	test('keeps a fallback verbatim, comments and strings included', () => {
		assert.deepEqual(readsOf("var(--a, /* b */ 'c, )' d)"), [['--a', "/* b */ 'c, )' d"]]);
	});

	test('skips strings, comments, and unquoted url()', () => {
		assert.deepEqual(readsOf('"var(--a, 1)" \'var(--b, 1)\' /* var(--c, 1) */'), []);
		assert.deepEqual(readsOf('url(var(--a, 1)) url("x") var(--b, 2)'), [['--b', '2']]);
	});

	test('reads nothing from a var() without a custom property name or closing paren', () => {
		assert.deepEqual(readsOf('var(a, 1) var(--, 1)'), []);
		assert.deepEqual(readsOf('var(--a, 1'), []);
		assert.deepEqual(readsOf('var(--a, 1) var(--b, (2)'), [['--a', '1']]);
	});

	test('keeps escaped and non-ASCII name characters', () => {
		assert.deepEqual(readsOf('var(--a\\.b, 1) var(--é, 2)'), [
			['--a\\.b', '1'],
			['--é', '2']
		]);
	});

	test('scans between start and end, with offsets into the text', () => {
		const text = 'a: var(--a, 1); b: var(--b, 2)';
		const reads = scanCssVarReads(text, 2, 14);
		assert.deepEqual(
			reads.map((read) => [read.name, read.offset]),
			[['--a', 3]]
		);
	});
});

describe('analyzeComponentCss', () => {
	test('a source without a style reads nothing', () => {
		assert.deepEqual(analyzeComponentCss('<div style:--a="1"></div>'), {
			properties: [],
			reads: new Map()
		});
	});

	test('reads the top-level style only, not a style nested in markup', () => {
		const source =
			'<svelte:head><style>a { color: var(--a, 1) }</style></svelte:head>\n<style>b { color: var(--b, 2) }</style>';
		assert.deepEqual(propertiesOf(source), [['--b', '2', 2]]);
	});

	test('a style tag written inside a script is script text', () => {
		const source =
			'<script>\n\tconst a = `<style>a { color: var(--a, 1) }</style>`;\n</script>\n<div></div>';
		assert.deepEqual(analyzeComponentCss(source), { properties: [], reads: new Map() });
	});

	test('script syntax never fails the parse', () => {
		const source =
			'<script lang="ts">\n\tconst a: = ;\n</script>\n<style>b { color: var(--b, 2) }</style>';
		assert.deepEqual(propertiesOf(source), [['--b', '2', 4]]);
	});

	test('lines count from the original source, a byte-order mark included', () => {
		const source = '﻿<div></div>\n\n<style>\n\tb {\n\t\tcolor: var(--b, 2);\n\t}\n</style>';
		assert.deepEqual(propertiesOf(source), [['--b', '2', 5]]);
	});

	test('a child component attribute leaves the name in the API', () => {
		const source =
			'<script>\n\timport A from "./A.svelte";\n</script>\n<A --a="1" style="--b: 1" />\n<style>b { color: var(--a, 2) var(--b, 3) }</style>';
		assert.deepEqual(
			propertiesOf(source).map(([name]) => name),
			['--a', '--b']
		);
	});

	test('a style attribute declaration through an expression name sets nothing', () => {
		const source =
			'<div style="{a}: 1; --b : 2"></div>\n<style>b { color: var(--a, 2) var(--b, 3) }</style>';
		assert.deepEqual(
			propertiesOf(source).map(([name]) => name),
			['--a']
		);
	});

	test('malformed CSS warns css_parse_failed at the parser position', () => {
		const result = analyzeComponentCss(
			'<div></div>\n<style>\n\ta {\n\t\t--b: { c };\n\t\tcolor: var(--a, 1);\n\t}\n</style>'
		);
		assert.deepEqual(result.properties, []);
		assert(result.problem?.kind === 'css_parse_failed');
		assert.strictEqual(result.problem.line, 4);
		assert.strictEqual(result.problem.column, 7);
		assert.include(result.problem.message, 'Expected a valid CSS identifier');
		assert.notInclude(result.problem.message, 'https://');
	});

	test('two top-level styles warn css_parse_failed', () => {
		const result = analyzeComponentCss('<style>a{}</style>\n<style>b{}</style>');
		assert(result.problem?.kind === 'css_parse_failed');
		assert.strictEqual(result.problem.line, 2);
	});

	test('a preprocessor language warns css_lang_unsupported, whatever its content', () => {
		for (const [attribute, lang] of [
			['lang="scss"', 'scss'],
			["lang='less'", 'less'],
			['type="text/scss"', 'text/scss']
		] as const) {
			const result = analyzeComponentCss(
				`<div></div>\n  <style ${attribute}>\n\t$a: 1;\n\tb { c { color: var(--a, $a); } }\n</style>`
			);
			assert.deepEqual(result.properties, []);
			assert.deepEqual(result.problem, {
				kind: 'css_lang_unsupported',
				message: `The <style> is "${lang}", not CSS, so the styling API isn't read.`,
				lang,
				line: 2,
				column: 3
			});
		}
	});

	test('lang="css" and type="text/css" read as CSS', () => {
		for (const attribute of ['lang="css"', 'lang="CSS"', 'type="text/css"']) {
			assert.deepEqual(
				propertiesOf(`<style ${attribute}>b { color: var(--a, 1) }</style>`),
				[['--a', '1', 1]],
				attribute
			);
		}
	});
});

describe('analyzeComponentCss reads', () => {
	/** `[name, line, fallback]` triples of every read a component makes. */
	const readsOfComponent = (source: string) =>
		[...(analyzeComponentCss(source).reads ?? [])].map(
			([name, { line, fallback }]) => [name, line, fallback] as const
		);

	test('lists every read, nested fallbacks and bare reads included, outermost first', () => {
		assert.deepEqual(
			readsOfComponent(
				'<style>\n\t.a { --c: 1; color: var(--a, var(--b, 1px)); margin: var(--c); }\n\t.b { padding: var(--b, 2px); }\n</style>\n'
			),
			[
				['--a', 2, 'var(--b, 1px)'],
				['--c', 2, undefined],
				['--b', 3, '2px']
			]
		);
	});

	test("reads the markup's static style text, without a style", () => {
		assert.deepEqual(
			readsOfComponent(
				'<!-- @component\n@cssprop --a -->\n<div style="color: var(--a, red); --b: {c}" style:margin="var(--d)"></div>\n<C --e="var(--f)" />\n'
			),
			[
				['--a', 3, 'red'],
				['--d', 3, undefined],
				['--f', 4, undefined]
			]
		);
	});

	test('a style-less source without a @cssprop mention reads nothing', () => {
		assert.deepEqual(analyzeComponentCss('<div style="color: var(--a, red)"></div>\n'), {
			properties: [],
			reads: new Map()
		});
	});

	test('a style-less source with var( only in a script string is never parsed', () => {
		// duplicate attributes fail the parse, which would warn css_parse_failed
		const source =
			'<script lang="ts">\n\tconst s = "var(--x)";\n</script>\n<div a="1" a="2"></div>\n';
		assert.deepEqual(analyzeComponentCss(source), { properties: [], reads: new Map() });
	});

	test('a style-less source with a tag but no var( reads nothing, with empty reads', () => {
		assert.deepEqual(analyzeComponentCss('<!-- @component\n@cssprop --a -->\n<div></div>\n'), {
			properties: [],
			reads: new Map()
		});
	});

	test('a style that is not read has no reads', () => {
		const css = analyzeComponentCss(
			'<style lang="scss">\n\t.a { color: var(--a, red); }\n</style>\n'
		);
		assert.strictEqual(css.reads, undefined);
		assert.strictEqual(css.problem?.kind, 'css_lang_unsupported');
	});
});

describe('documentCssProperties', () => {
	const SOURCE =
		'<style>\n\t.a { color: var(--a, red); margin: var(--b); padding: var(--c, 1px); }\n</style>\n';

	test('documented entries come first in tag order, then the rest in read order', () => {
		const { properties, unread } = documentCssProperties(
			analyzeComponentCss(SOURCE),
			[
				{ name: '--x', description: 'd1' },
				{ name: '--b', syntax: '<length>' },
				{ name: '--a', fallback: 'blue' }
			],
			() => 9
		);
		assert.deepEqual(properties, [
			{ name: '--x', description: 'd1', sourceLine: 9, documented: true },
			{ name: '--b', syntax: '<length>', sourceLine: 2, documented: true },
			{ name: '--a', fallback: 'blue', sourceLine: 2, documented: true },
			{ name: '--c', fallback: '1px', sourceLine: 2 }
		]);
		assert.deepEqual(unread, [{ name: '--x', description: 'd1' }]);
	});

	test('without tags, the heuristic list as is', () => {
		const css = analyzeComponentCss(SOURCE);
		assert.deepEqual(
			documentCssProperties(css, [], () => 1),
			{
				properties: css.properties,
				unread: []
			}
		);
	});

	test('a style that is not read keeps every tag and reports none', () => {
		const css = analyzeComponentCss(
			'<style lang="scss">\n\t.a { color: var(--a, red); }\n</style>\n'
		);
		assert.deepEqual(
			documentCssProperties(css, [{ name: '--a' }], () => 4),
			{ properties: [{ name: '--a', sourceLine: 4, documented: true }], unread: [] }
		);
	});
});

describe('findCsspropTagLine', () => {
	const SOURCE = '<!--\n@component\n@cssprop --ab - c\n@cssproperty {<color>} [--a=1] - b\n-->\n';

	test('finds the tag naming the property, by its parsed name', () => {
		assert.strictEqual(findCsspropTagLine(SOURCE, 0, SOURCE.length, '--a'), 4);
		assert.strictEqual(findCsspropTagLine(SOURCE, 0, SOURCE.length, '--ab'), 3);
	});

	test('searches only the range', () => {
		assert.strictEqual(findCsspropTagLine(SOURCE, 0, 20, '--a'), undefined);
		assert.strictEqual(findCsspropTagLine(SOURCE, 0, SOURCE.length, '--b'), undefined);
	});

	test('finds line-leading tags only, after a comment opener', () => {
		const source =
			'<script>\n\t// see @cssprop --a below\n\t/** @cssprop --b */\n\t/**\n\t * x @cssprop --c\n\t * @cssprop --a - real\n\t */\n</script>\n<!-- @cssprop --d -->\n';
		assert.strictEqual(findCsspropTagLine(source, 0, source.length, '--a'), 6);
		assert.strictEqual(findCsspropTagLine(source, 0, source.length, '--b'), 3);
		assert.strictEqual(findCsspropTagLine(source, 0, source.length, '--c'), undefined);
		assert.strictEqual(findCsspropTagLine(source, 0, source.length, '--d'), 9);
	});
});
