/**
 * Tests for locating a component's script tags (`svelte-scripts.ts`): which
 * `<script>` tags are top-level, and which of the three routes decided it.
 *
 * 1. the routes — the scan's own proof, Svelte's parser, and the fallback
 *    when the parser throws
 * 2. agreement — over this repo's Svelte files and a list of adversarial
 *    sources, every tag the scan proves top-level is one Svelte's parser
 *    places at the top level. This is the evidence that skipping the parser
 *    is sound.
 */

import { test, assert, describe } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'svelte/compiler';
import { globSync } from 'tinyglobby';

import {
	findScriptTags,
	isModuleScript,
	scanScriptTags,
	type ParseSvelteTemplate
} from '#lib/svelte-scripts.ts';

/** The contents of the tags `findScriptTags` returns, trimmed. */
const contentsOf = (source: string, options?: Parameters<typeof findScriptTags>[1]) =>
	findScriptTags(source, options).tags.map((tag) => tag.content.trim());

/** A parser that must not run. */
const parseNever: ParseSvelteTemplate = () => {
	throw new Error('the parser ran');
};

/**
 * Svelte's parser as it behaves before `loose` parsing existed: the option is
 * ignored, so a template error throws.
 */
const parseWithoutLoose: ParseSvelteTemplate = (source) => parse(source, { modern: true });

describe('findScriptTags decided by the scan', () => {
	const scanned = (source: string) => {
		// a throwing parser proves the route: the answer came without it
		const found = findScriptTags(source, { parseTemplate: parseNever });
		assert.strictEqual(found.decidedBy, 'scan');
		return found.tags;
	};

	test('a source with no script tag', () => {
		assert.deepStrictEqual(scanned(''), []);
		assert.deepStrictEqual(scanned('<div>text1</div>'), []);
	});

	test('scripts ahead of the template', () => {
		const tags = scanned(`<script module lang="ts">
	export const a = 1;
</script>

<!-- a comment -->
<script lang="ts">
	let b = 1;
</script>

<div>{b}</div>`);
		assert.deepStrictEqual(
			tags.map((tag) => isModuleScript(tag.attributes)),
			[true, false]
		);
		assert.strictEqual(tags[0]!.attributes.get('lang'), 'ts');
		assert.include(tags[1]!.content, 'let b = 1');
	});

	test('the content offset points into the source', () => {
		const source = `<!-- c -->\n<script>\n\tlet a = 1;\n</script>`;
		const [tag] = scanned(source);
		assert.strictEqual(source.slice(tag!.start, tag!.start + tag!.content.length), tag!.content);
	});

	test('a quoted attribute value may hold anything but its quote', () => {
		const tags = scanned(
			`<script lang="ts" generics="T extends Record<string, {a: 1}>">\n\tlet a: T;\n</script>`
		);
		assert.strictEqual(tags[0]!.attributes.get('generics'), 'T extends Record<string, {a: 1}>');
	});

	test('a commented-out script ahead of the real one is skipped', () => {
		const tags = scanned(`<!-- <script>let a = 1;</script> -->\n<script>let b = 2;</script>`);
		assert.deepStrictEqual(
			tags.map((tag) => tag.content),
			['let b = 2;']
		);
	});
});

describe('findScriptTags decided by the parser', () => {
	const parsed = (source: string) => {
		const found = findScriptTags(source);
		assert.strictEqual(found.decidedBy, 'parser');
		return found.tags.map((tag) => tag.content.trim());
	};

	test('a script nested in <svelte:head> ahead of the instance script is not one of the component scripts', () => {
		assert.deepStrictEqual(
			parsed(`<svelte:head>
	<script>
		export let nested = 1;
	</script>
</svelte:head>
<script lang="ts">
	export let a: string;
</script>`),
			['export let a: string;']
		);
	});

	test('a script nested in an element or a block is not one of the component scripts', () => {
		assert.deepStrictEqual(parsed(`<div><script>let nested = 1;</script></div>`), []);
		assert.deepStrictEqual(
			parsed(`{#if true}<script>let nested = 1;</script>{/if}\n<script>let a = 1;</script>`),
			['let a = 1;']
		);
	});

	test('a nested module script is not the module script', () => {
		const found = findScriptTags(`<svelte:head>
	<script module>
		export const nested = 1;
	</script>
</svelte:head>
<script module>
	export const a = 1;
</script>`);
		assert.strictEqual(found.decidedBy, 'parser');
		assert.strictEqual(found.tags.length, 1);
		assert.include(found.tags[0]!.content, 'export const a = 1');
	});

	test('a non-JavaScript script nested after the instance script is left out', () => {
		assert.deepStrictEqual(
			parsed(`<script>let a = 1;</script>
<svelte:head>
	<script type="application/ld+json">{"@context": "https://fuz.dev"}</script>
</svelte:head>`),
			['let a = 1;']
		);
	});

	test('a script below the template is top-level', () => {
		assert.deepStrictEqual(parsed(`<div>text1</div>\n<script>let a = 1;</script>`), ['let a = 1;']);
	});

	test('a script after a <style> or <svelte:options> is top-level', () => {
		assert.deepStrictEqual(
			parsed(`<style>\n\tdiv { color: red; }\n</style>\n<script>let a = 1;</script>`),
			['let a = 1;']
		);
		assert.deepStrictEqual(parsed(`<svelte:options runes />\n<script>let a = 1;</script>`), [
			'let a = 1;'
		]);
	});

	test('script content the parser would reject is never parsed', () => {
		// blanked before the parse: a script mid-edit still gets located
		assert.deepStrictEqual(parsed(`<div>text1</div>\n<script>let a = ;</script>`), ['let a = ;']);
	});

	test('style content the parser would reject is never parsed', () => {
		assert.deepStrictEqual(
			parsed(
				`<div>text1</div>\n<script>let a = 1;</script>\n<style lang="scss">\n\t$a: red;\n\tdiv { color: $a; }\n</style>`
			),
			['let a = 1;']
		);
	});

	test('a <style> spelled in a script string does not blank through to the real style', () => {
		// the style matcher would otherwise run from the string to the real
		// `</style>` and blank the `</script>` between them
		assert.deepStrictEqual(
			parsed(
				`<div>text1</div>\n<script>let a = "<style>";</script>\n<style>\n\tdiv { color: red; }\n</style>`
			),
			['let a = "<style>";']
		);
	});

	test('a script spelled inside a <style> is not a script', () => {
		assert.deepStrictEqual(parsed(`<style>/* <script>let a = 1;</script> */</style>`), []);
	});

	test('a byte-order mark does not shift the offsets', () => {
		// Svelte's `parse` strips a leading mark, which would move every offset
		// it reports by one
		const source = `\uFEFF<div>text1</div>\n<script>let a = 1;</script>`;
		const found = findScriptTags(source);
		assert.strictEqual(found.decidedBy, 'parser');
		assert.strictEqual(found.tags.length, 1);
		assert.strictEqual(source.slice(found.tags[0]!.start).startsWith('let a = 1;'), true);
	});

	test('`scanProof: false` sends a provable source to the parser, with the same answer', () => {
		const source = `<script module>export const a = 1;</script>\n<script>let b = 2;</script>`;
		const proven = findScriptTags(source);
		const parsedToo = findScriptTags(source, { scanProof: false });
		assert.strictEqual(proven.decidedBy, 'scan');
		assert.strictEqual(parsedToo.decidedBy, 'parser');
		assert.deepStrictEqual(parsedToo.tags, proven.tags);
	});
});

describe('findScriptTags when the parser throws', () => {
	// nested script first, so the fallback's answer is visibly every matched tag
	const NESTED_THEN_REAL = `<svelte:head><script>let nested = 1;</script></svelte:head>
<script>let a = 1;</script>`;

	test('a template error loose parsing does not absorb returns every matched tag', () => {
		const source = `${NESTED_THEN_REAL}\n<div>{#if}</div>`;
		const found = findScriptTags(source);
		assert.strictEqual(found.decidedBy, 'unparsed');
		assert.deepStrictEqual(contentsOf(source), ['let nested = 1;', 'let a = 1;']);
	});

	test('a parser without loose parsing falls back on a template error', () => {
		// an unclosed element: loose parsing reads through it, strict throws
		const source = `${NESTED_THEN_REAL}\n<div>`;
		assert.strictEqual(findScriptTags(source).decidedBy, 'parser');
		assert.deepStrictEqual(contentsOf(source), ['let a = 1;']);

		const found = findScriptTags(source, { parseTemplate: parseWithoutLoose });
		assert.strictEqual(found.decidedBy, 'unparsed');
		assert.deepStrictEqual(
			found.tags.map((tag) => tag.content),
			['let nested = 1;', 'let a = 1;']
		);
	});

	test('a parser without loose parsing still decides a valid template', () => {
		const found = findScriptTags(NESTED_THEN_REAL, { parseTemplate: parseWithoutLoose });
		assert.strictEqual(found.decidedBy, 'parser');
		assert.deepStrictEqual(
			found.tags.map((tag) => tag.content),
			['let a = 1;']
		);
	});

	test('a self-closing top-level script is not proven, and the parser rejects it', () => {
		const found = findScriptTags(`<script />\n<script>let a = 1;</script>`);
		assert.strictEqual(found.decidedBy, 'unparsed');
		assert.deepStrictEqual(
			found.tags.map((tag) => tag.content),
			['let a = 1;']
		);
	});

	test('what a </script> in a string leaves behind is not proven past', () => {
		// the first match ends inside the string, so the rest is unaccounted text
		const source = `<script>let a = "</script>";</script>\n<div><script>let nested = 1;</script></div>`;
		assert.deepStrictEqual(
			scanScriptTags(source).map((tag) => tag.provenTopLevel),
			[true, false]
		);
		assert.strictEqual(findScriptTags(source).decidedBy, 'unparsed');
	});
});

/** A hand-written source for the agreement test. */
interface AdversarialSource {
	name: string;
	source: string;
	/** `provenTopLevel` of each scanned tag, in order: `P` proven, `u` unproven. */
	proven: string;
	/**
	 * Set when neither oracle can parse the source, so the case pins only
	 * what the scan proves.
	 */
	unverifiable?: true;
}

// Script content is plain JavaScript wherever the case allows, so Svelte's
// parser reads the source unblanked and serves as an oracle.
const ADVERSARIAL_SOURCES: Array<AdversarialSource> = [
	{ name: 'a lone script', source: `<script>let a = 1;</script>`, proven: 'P' },
	{
		name: 'module then instance',
		source: `<script module>export const a = 1;</script>\n\n<script>let b = 2;</script>`,
		proven: 'PP'
	},
	{
		name: 'whitespace of every kind before the script',
		source: ` \t\r\n\u00a0\u2028<script>let a = 1;</script>`,
		proven: 'P'
	},
	{ name: 'a byte-order mark', source: `\uFEFF<script>let a = 1;</script>`, proven: 'P' },
	{
		name: 'comments between scripts',
		source: `<!-- a --><script module>export const a = 1;</script><!-- b -->\n<!-- c -->\n<script>let b = 2;</script>`,
		proven: 'PP'
	},
	{
		name: 'a commented-out script',
		source: `<!-- <script>let a = 1;</script> -->\n<script>let b = 2;</script>`,
		proven: 'P'
	},
	{
		name: 'a comment holding an opening tag only',
		source: `<!-- <div> -->\n<script>let a = 1;</script>`,
		proven: 'P'
	},
	{
		name: 'a comment that closes at once',
		source: `<!---->\n<script>let a = 1;</script>`,
		proven: 'P'
	},
	{
		name: 'an unterminated comment',
		source: `<!-- <script>let a = 1;</script>`,
		proven: 'u',
		unverifiable: true
	},
	{
		name: 'a comment closed inside a script',
		source: `<!-- <script>let a = "-->";</script>\n<script>let b = 2;</script>`,
		proven: 'u',
		unverifiable: true
	},
	{ name: 'text first', source: `text1 <script>let a = 1;</script>`, proven: 'u' },
	{ name: 'an expression first', source: `{1}<script>let a = 1;</script>`, proven: 'u' },
	{
		name: 'nested in an element',
		source: `<div><script>let nested = 1;</script></div>`,
		proven: 'u'
	},
	{
		name: 'nested in <svelte:head> first',
		source: `<svelte:head><script>let nested = 1;</script></svelte:head>\n<script>let a = 1;</script>`,
		proven: 'uu'
	},
	{
		name: 'nested after a proven script',
		source: `<script>let a = 1;</script>\n<svelte:head><script>let nested = 1;</script></svelte:head>`,
		proven: 'Pu'
	},
	{
		name: 'nested in a block',
		source: `{#if true}<script>let nested = 1;</script>{/if}\n<script>let a = 1;</script>`,
		proven: 'uu'
	},
	{
		name: 'nested in a component',
		source: `<Comp><script>let nested = 1;</script></Comp>`,
		proven: 'u'
	},
	{
		name: 'an uppercase tag wrapping a script',
		source: `<SCRIPT><script>let nested = 1;</script></SCRIPT>`,
		proven: 'u'
	},
	{
		name: 'an uppercase tag first',
		source: `<SCRIPT>text1</SCRIPT>\n<script>let a = 1;</script>`,
		proven: 'u'
	},
	{
		name: '<svelte:options> first',
		source: `<svelte:options runes />\n<script>let a = 1;</script>`,
		proven: 'u'
	},
	{
		name: 'a leading style',
		source: `<style>div { color: red; }</style>\n<script>let a = 1;</script>`,
		proven: 'u'
	},
	{
		name: 'a script spelled in a leading style comment',
		source: `<style>/* <script>let nested = 1;</script> */</style>`,
		proven: 'u'
	},
	{
		// Svelte's CSS parser reads the string whole, so the script is CSS text
		name: 'a script spelled in a leading style string',
		source: `<style>div::before { content: "</style><script>let nested = 1;</script>"; }</style>`,
		proven: 'u'
	},
	{
		name: 'a self-closing script first',
		source: `<script />\n<script>let a = 1;</script>`,
		proven: 'u',
		unverifiable: true
	},
	{
		name: 'a nested self-closing script first',
		source: `<div><script src="a" /></div>\n<script>let a = 1;</script>`,
		proven: 'u'
	},
	{
		name: 'a self-closing script after a proven one',
		source: `<script>let a = 1;</script>\n<div><script src="a" /><script>let nested = 1;</script></div>`,
		proven: 'Pu'
	},
	{
		// the match ends inside the string; the rest is unaccounted text
		name: '</script> in a string, then a nested script',
		source: `<script>let a = "</script>";</script>\n<div><script>let nested = 1;</script></div>`,
		proven: 'Pu',
		unverifiable: true
	},
	{
		name: 'a closing tag with whitespace',
		source: `<script>let a = 1;</script\n >\n<script module>export const b = 2;</script >`,
		proven: 'PP'
	},
	{
		name: 'a multiline opening tag',
		source: `<script\n\tlang="ts"\n\tgenerics="T extends {a: 1}"\n>\n\tlet a: T;\n</script>`,
		proven: 'P'
	},
	{
		name: '> and a closing tag inside a quoted value',
		source: `<script data-a="x></script>y">let a = 1;</script>`,
		proven: 'P'
	},
	{
		name: 'single-quoted and bare values',
		source: `<script lang='ts' context=module>export const a: number = 1;</script>`,
		proven: 'P'
	},
	{
		name: 'an unterminated quote read as a bare value',
		source: `<script data-a="b>let a = 1;</script>`,
		proven: 'u'
	},
	{
		// The regex reads `data-a` as the bare value `"x` and ends the tag at
		// the first `>`, then matches a second script. Svelte reads the quoted
		// value through to the second `"`, takes `data-b= "y"` (whitespace
		// after `=`, which the regex can't match), and finds one script whose
		// content is `let b = 2;`: the second match is attribute text.
		name: 'a quoted value the regex backtracks out of',
		source: `<script data-a="x>let a = 1;</script> <script>" data-b= "y">let b = 2;</script>`,
		proven: 'uu'
	},
	{
		name: 'a bare value ending in a slash',
		source: `<script data-a=b/>let a = 1;</script>`,
		proven: 'u'
	},
	{
		name: 'a no-break space inside the opening tag',
		source: `<script\u00a0lang="ts">let a: number = 1;</script>`,
		proven: 'u'
	},
	{
		// the regex reads one bare value, `"ts"generics="T"`
		name: 'adjacent quoted attributes',
		source: `<script lang="ts"generics="T">let a: T;</script>`,
		proven: 'u'
	},
	{
		name: 'whitespace before an attribute =',
		source: `<script lang ="ts">let a = 1;</script>\n<script module>export const b = 2;</script>`,
		proven: 'u',
		unverifiable: true
	},
	{
		name: 'whitespace after an attribute =',
		source: `<script data-a= "b">let a = 1;</script>\n<script module>export const b = 2;</script>`,
		proven: 'u'
	},
	{
		name: 'duplicate instance scripts',
		source: `<script>let a = 1;</script>\n<script>let b = 2;</script>`,
		proven: 'PP',
		unverifiable: true
	},
	{
		name: 'a script below the template',
		source: `<div>text1</div>\n<script>let a = 1;</script>`,
		proven: 'u'
	},
	{
		name: 'a script tag in an expression string',
		source: `<script>let a = 1;</script>\n<pre>{'<script lang="ts">let b = 2;</script>'}</pre>`,
		proven: 'Pu'
	},
	{
		name: 'a style spelled in a script string, a real style after',
		source: `<script>let a = "<style>";</script>\n<div>text1</div>\n<style>div { color: red; }</style>`,
		proven: 'P'
	},
	{
		name: 'an unclosed element after the script',
		source: `<script>let a = 1;</script>\n<div><script>let nested = 1;</script>`,
		proven: 'Pu'
	}
];

/**
 * Where Svelte's parser, reading the source as written, places the top-level
 * scripts: the offsets of their opening `<`. `undefined` when it throws.
 */
const parseAsWritten = (source: string): Set<number> | undefined => {
	try {
		// a space for the byte-order mark `parse` would strip, keeping offsets
		const root = parse(source.replace(/^\uFEFF/, ' '), { modern: true });
		const starts = new Set<number>();
		if (root.instance) starts.add(root.instance.start);
		if (root.module) starts.add(root.module.start);
		return starts;
	} catch (_) {
		return undefined;
	}
};

/**
 * Assert that every tag the scan proves top-level in `source` is top-level to
 * both oracles: Svelte's parser on the source as written, and the blanked
 * parse `findScriptTags` falls back on. An oracle that throws says nothing.
 *
 * @returns which oracles spoke, and the scanned tags
 */
const assertProvenTagsAreTopLevel = (source: string, label: string) => {
	const scanned = scanScriptTags(source);
	const asWritten = parseAsWritten(source);
	const blanked = findScriptTags(source, { scanProof: false });
	// a source with no tag to ask about is answered without parsing
	const blankedStarts =
		blanked.decidedBy === 'unparsed' ? undefined : new Set(blanked.tags.map((tag) => tag.start));
	for (const tag of scanned) {
		if (!tag.provenTopLevel) continue;
		if (asWritten) {
			assert.isTrue(
				asWritten.has(tag.open),
				`${label}: the scan proved the tag at ${tag.open}, which Svelte's parser doesn't place at the top level`
			);
		}
		if (blankedStarts) {
			assert.isTrue(
				blankedStarts.has(tag.start),
				`${label}: the scan proved the tag at ${tag.open}, which the blanked parse doesn't place at the top level`
			);
		}
	}
	return { scanned, asWritten, blankedStarts };
};

describe('scan proof agrees with the parser', () => {
	test('over the Svelte files of this repo', () => {
		const root = process.cwd();
		const files = globSync('src/**/*.svelte', { cwd: root });
		let proven = 0;
		let unproven = 0;
		for (const file of files) {
			const source = readFileSync(join(root, file), 'utf8');
			const { scanned, asWritten, blankedStarts } = assertProvenTagsAreTopLevel(source, file);
			for (const tag of scanned) {
				if (tag.provenTopLevel) proven++;
				else unproven++;
			}
			// the repo's files all parse, so both oracles speak, and they agree
			// with each other about every scanned tag
			assert.ok(asWritten, `${file}: Svelte's parser threw`);
			assert.ok(blankedStarts, `${file}: the blanked parse threw`);
			for (const tag of scanned) {
				assert.strictEqual(
					blankedStarts.has(tag.start),
					asWritten.has(tag.open),
					`${file}: the blanked parse and Svelte's parser disagree about the tag at ${tag.open}`
				);
			}
		}
		// both routes are exercised
		assert.isAbove(proven, 0);
		assert.isAbove(unproven, 0);
	});

	for (const { name, source, proven, unverifiable } of ADVERSARIAL_SOURCES) {
		test(`adversarial: ${name}`, () => {
			const { scanned, asWritten, blankedStarts } = assertProvenTagsAreTopLevel(source, name);
			assert.strictEqual(scanned.map((tag) => (tag.provenTopLevel ? 'P' : 'u')).join(''), proven);
			// a case is evidence only if an oracle read it
			assert.strictEqual(
				asWritten === undefined && blankedStarts === undefined,
				unverifiable === true,
				'whether an oracle parsed the source'
			);
		});
	}
});

const provenOf = (source: string): string =>
	scanScriptTags(source)
		.map((tag) => (tag.provenTopLevel ? 'P' : 'u'))
		.join('');

describe('scan proof conditions without an existing case', () => {
	test('whitespace other than space, tab and newlines before the closing > is not proven', () => {
		// pins the trailing `[ \t\r\n]*` of `UNAMBIGUOUS_ATTRIBUTES_MATCHER`
		assert.strictEqual(provenOf(`<script lang="ts"\u00a0>let a: number = 1;</script>`), 'u');
		assert.strictEqual(provenOf(`<script\f>let a = 1;</script>`), 'u');
	});

	test('an attribute name outside the word grammar is not proven', () => {
		// pins the `[A-Za-z][\w-]*` name: Svelte reads these names too, so the
		// narrow grammar is caution, not a known disagreement
		assert.strictEqual(provenOf(`<script a:b>let a = 1;</script>`), 'u');
		assert.strictEqual(provenOf(`<script {a}>let a = 1;</script>`), 'u');
		assert.strictEqual(provenOf(`<script 1a>let a = 1;</script>`), 'u');
	});
});

describe('blanking conditions without an existing case', () => {
	test('the style search resumes after a script that spells a <style>', () => {
		// the real style holds content the parser rejects, so it has to be
		// found and blanked after the script whose string opened a false one
		const source = `<div>text1</div>\n<script>let a = "<style>";</script>\n<style lang="scss">\n\t$a: red;\n\tdiv { color: $a; }\n</style>`;
		const found = findScriptTags(source);
		assert.strictEqual(found.decidedBy, 'parser');
		assert.deepStrictEqual(
			found.tags.map((tag) => tag.content),
			['let a = "<style>";']
		);
	});
});
