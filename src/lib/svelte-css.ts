/**
 * A Svelte component's styling API: the CSS custom properties its `<style>`
 * reads with a fallback and leaves for a consumer to set
 * (`ComponentDeclarationJson.cssCustomProperties`).
 *
 * Svelte's own parser reads the component, with script content blanked, so
 * the stylesheet and the markup come from one parse: `ast.css` gives the
 * declarations, and the template gives the `style:--x` directives and
 * `style` attributes that set properties internally. Declaration values are
 * scanned from the original source text (`scanCssVarReads`), since the parser
 * strips comments from them and gives no offsets inside them.
 *
 * @internal
 *
 * @module
 */

import { parse, type AST } from 'svelte/compiler';

import { toErrorMessage } from './error.ts';
import { blankVerbatimContent, scanScriptTags } from './svelte-scripts.ts';
import type { ComponentCssPropertyJson } from './types.ts';

/** One `var()` read in CSS text. */
export interface CssVarRead {
	/** The custom property's name as written, `--` included. */
	name: string;
	/**
	 * The fallback after the comma, trimmed, verbatim (comments included);
	 * `undefined` for a read without one, `''` for `var(--a,)`.
	 */
	fallback: string | undefined;
	/** Offset of the read's `var` within the scanned text. */
	offset: number;
}

const isNameChar = (code: number): boolean =>
	(code >= 0x30 && code <= 0x39) || // 0-9
	(code >= 0x41 && code <= 0x5a) || // A-Z
	(code >= 0x61 && code <= 0x7a) || // a-z
	code === 0x2d || // -
	code === 0x5f || // _
	code >= 0x80;

/** Index just past the string opening at `start` (its quote), or the text's end. */
const skipString = (text: string, start: number, end: number): number => {
	const quote = text[start];
	let i = start + 1;
	while (i < end) {
		const char = text[i];
		if (char === '\\') i += 2;
		else if (char === quote || char === '\n') return i + 1;
		else i++;
	}
	return end;
};

/** Index just past the comment opening at `start`, or the text's end when it's unterminated. */
const skipComment = (text: string, start: number, end: number): number => {
	const close = text.indexOf('*/', start + 2);
	return close === -1 || close + 2 > end ? end : close + 2;
};

/** Index of the first character at or after `start` that isn't whitespace or in a comment. */
const skipTrivia = (text: string, start: number, end: number): number => {
	let i = start;
	while (i < end) {
		const char = text[i];
		if (char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f') i++;
		else if (char === '/' && text[i + 1] === '*') i = skipComment(text, i, end);
		else break;
	}
	return i;
};

/**
 * Index of the `)` closing a parenthesized group whose content starts at
 * `start`, skipping strings, comments, and nested groups, or `-1` when it's
 * unclosed.
 */
const findClose = (text: string, start: number, end: number): number => {
	let depth = 0;
	let i = start;
	while (i < end) {
		const char = text[i];
		if (char === '"' || char === "'") i = skipString(text, i, end);
		else if (char === '/' && text[i + 1] === '*') i = skipComment(text, i, end);
		else if (char === '\\') i += 2;
		else {
			if (char === '(') depth++;
			else if (char === ')') {
				if (depth === 0) return i;
				depth--;
			}
			i++;
		}
	}
	return -1;
};

/**
 * Scan CSS text for its outermost `var()` reads, in source order.
 *
 * A read nested in another one's fallback isn't returned
 * (`var(--a, var(--b))` reads `--a`, with `var(--b)` its fallback), and
 * neither is anything in a string, a comment, or an unquoted `url()`. The
 * function name matches case-insensitively, as CSS does; a `var(` with no
 * `--` name or no closing `)` reads nothing.
 *
 * @param text - CSS text, typically a declaration's value
 * @param start - offset to start scanning at
 * @param end - offset to stop scanning at
 * @returns the reads, with offsets into `text`
 */
export const scanCssVarReads = (text: string, start = 0, end = text.length): Array<CssVarRead> => {
	const reads: Array<CssVarRead> = [];
	let i = start;
	while (i < end) {
		const char = text[i]!;
		if (char === '"' || char === "'") {
			i = skipString(text, i, end);
			continue;
		}
		if (char === '/' && text[i + 1] === '*') {
			i = skipComment(text, i, end);
			continue;
		}
		if (char === '\\') {
			i += 2;
			continue;
		}
		if (!isNameChar(char.charCodeAt(0))) {
			i++;
			continue;
		}
		// an identifier: a function name when a `(` follows it
		const identStart = i;
		while (i < end && (isNameChar(text.charCodeAt(i)) || text[i] === '\\')) {
			i += text[i] === '\\' ? 2 : 1;
		}
		if (text[i] !== '(') continue;
		const fn = text.slice(identStart, i).toLowerCase();
		const open = i + 1;
		if (fn === 'url') {
			// an unquoted url's content is raw, so skip it whole
			const close = findClose(text, open, end);
			i = close === -1 ? end : close + 1;
			continue;
		}
		if (fn !== 'var') {
			// other functions' arguments are scanned like the rest
			i = open;
			continue;
		}
		const close = findClose(text, open, end);
		if (close === -1) return reads;
		i = close + 1;
		const nameStart = skipTrivia(text, open, close);
		if (!text.startsWith('--', nameStart)) continue;
		let nameEnd = nameStart + 2;
		while (nameEnd < close && (isNameChar(text.charCodeAt(nameEnd)) || text[nameEnd] === '\\')) {
			nameEnd += text[nameEnd] === '\\' ? 2 : 1;
		}
		const name = text.slice(nameStart, nameEnd);
		if (name === '--') continue;
		const afterName = skipTrivia(text, nameEnd, close);
		const fallback = text[afterName] === ',' ? text.slice(afterName + 1, close).trim() : undefined;
		reads.push({ name, fallback, offset: identStart });
	}
	return reads;
};

/** Why a component's styling API wasn't read. */
export type ComponentCssProblem =
	| { kind: 'css_parse_failed'; message: string; line?: number; column?: number }
	| { kind: 'css_lang_unsupported'; message: string; lang: string; line: number; column: number };

/** What `analyzeComponentCss` reads from a component. */
export interface ComponentCss {
	/** The styling API, in the order of each name's first read. */
	properties: Array<ComponentCssPropertyJson>;
	/** Why the style wasn't read, when it wasn't. */
	problem?: ComponentCssProblem;
}

/** The style language an attribute map names, as written, or `undefined` for CSS. */
const styleLanguageOf = (
	lang: string | true | undefined,
	type: string | true | undefined
): string | undefined => {
	if (typeof lang === 'string' && lang.toLowerCase() !== 'css') return lang;
	if (typeof type === 'string' && type.toLowerCase() !== 'text/css') return type;
	return undefined;
};

/** An AST attribute's static text, `true` when bare, `undefined` when dynamic. */
const attributeText = (attribute: AST.Attribute): string | true | undefined => {
	const { value } = attribute;
	if (value === true) return true;
	if (!Array.isArray(value)) return undefined;
	let text = '';
	for (const part of value) {
		if (part.type !== 'Text') return undefined;
		text += part.data;
	}
	return text;
};

/** Starts of each line in `text`, for offset → line lookups. */
const lineStartsOf = (text: string): Array<number> => {
	const starts = [0];
	for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
	return starts;
};

/** 1-based line of `offset`, by binary search over `lineStarts`. */
const lineAt = (lineStarts: ReadonlyArray<number>, offset: number): number => {
	let low = 0;
	let high = lineStarts.length - 1;
	while (low < high) {
		const mid = (low + high + 1) >> 1;
		if (lineStarts[mid]! <= offset) low = mid;
		else high = mid - 1;
	}
	return low + 1;
};

// one placeholder per expression in a `style` attribute, so `--a: {b}` keeps its shape
const STYLE_ATTRIBUTE_EXPRESSION = '\u0000';
const STYLE_ATTRIBUTE_PROPERTY = /^\s*(--[^\s:]+)\s*:/;

/** Custom properties a `style` attribute's static text declares (`style="--a: {b}"`). */
const collectStyleAttributeProperties = (attribute: AST.Attribute, names: Set<string>): void => {
	const { value } = attribute;
	if (!Array.isArray(value)) return;
	const text = value
		.map((part) => (part.type === 'Text' ? part.data : STYLE_ATTRIBUTE_EXPRESSION))
		.join('');
	for (const declaration of text.split(';')) {
		const match = STYLE_ATTRIBUTE_PROPERTY.exec(declaration);
		if (match) names.add(match[1]!);
	}
};

/**
 * The custom properties the markup sets on the component's own elements:
 * `style:--a` directives and `--a:` in `style` attributes, on elements and
 * `<svelte:element>`, at any depth. A child component's `--a` attribute
 * styles the child, so it doesn't count.
 */
const collectMarkupProperties = (fragment: AST.Fragment, names: Set<string>): void => {
	for (const node of fragment.nodes) {
		if (node.type === 'RegularElement' || node.type === 'SvelteElement') {
			for (const attribute of node.attributes) {
				if (attribute.type === 'StyleDirective') {
					if (attribute.name.startsWith('--')) names.add(attribute.name);
				} else if (attribute.type === 'Attribute' && attribute.name.toLowerCase() === 'style') {
					collectStyleAttributeProperties(attribute, names);
				}
			}
		}
		// every child fragment, whatever the node calls it (`fragment`, `body`,
		// `consequent`, `then`, …); expressions are never fragments
		for (const value of Object.values(node)) {
			if (value && typeof value === 'object' && (value as { type?: unknown }).type === 'Fragment') {
				collectMarkupProperties(value as AST.Fragment, names);
			}
		}
	}
};

type CssNode = AST.CSS.StyleSheet['children'][number] | AST.CSS.Block['children'][number];

/** A read's first appearance: where, and the first fallback any read of the name gives. */
interface FirstRead {
	offset: number;
	fallback: string | undefined;
}

/**
 * Collect the stylesheet's own custom property declarations into `defined`
 * and its outermost `var()` reads into `reads`, in source order, at every
 * depth: rules, nested rules, and at-rule blocks (`@media`, keyframes, …).
 */
const collectStylesheet = (
	nodes: ReadonlyArray<CssNode>,
	svelteSource: string,
	defined: Set<string>,
	reads: Map<string, FirstRead>
): void => {
	for (const node of nodes) {
		if (node.type === 'Declaration') {
			if (node.property.startsWith('--')) defined.add(node.property);
			// the value read from the source, where comments and offsets survive
			for (const read of scanCssVarReads(
				svelteSource,
				node.start + node.property.length,
				node.end
			)) {
				const first = reads.get(read.name);
				if (!first) reads.set(read.name, { offset: read.offset, fallback: read.fallback });
				else if (first.fallback === undefined) first.fallback = read.fallback;
			}
		} else if (node.block) {
			collectStylesheet(node.block.children, svelteSource, defined, reads);
		}
	}
};

const noCss = (): ComponentCss => ({ properties: [] });

/**
 * Read a component's styling API: the custom properties its top-level
 * `<style>` reads through an outermost `var()` with a fallback, minus the ones
 * it sets itself. The policy is `ComponentDeclarationJson.cssCustomProperties`'s.
 *
 * One parse with Svelte's parser (`modern`, `loose`) over the source with its
 * script content blanked, so script syntax never fails it. A style whose
 * `lang` or `type` names another language is blanked too, and reported as
 * `css_lang_unsupported`. A parse failure reports `css_parse_failed`, with
 * the parser's position. A source with no `<style` text isn't parsed.
 *
 * @param svelteSource - the full Svelte source code
 * @returns the styling API, plus the problem when the style wasn't read
 */
export const analyzeComponentCss = (svelteSource: string): ComponentCss => {
	if (!svelteSource.includes('<style')) return noCss();
	const blanked = blankVerbatimContent(svelteSource, scanScriptTags(svelteSource), {
		keepStyle: (attributes) =>
			styleLanguageOf(attributes.get('lang'), attributes.get('type')) === undefined
	});
	let ast: AST.Root;
	try {
		ast = parse(blanked, { modern: true, loose: true });
	} catch (err) {
		const start = (err as { start?: { line?: unknown; column?: unknown } } | null)?.start;
		const problem: ComponentCssProblem = {
			kind: 'css_parse_failed',
			// the first line, without the docs link Svelte appends
			message: `Svelte's parser failed, so the styling API isn't read: ${toErrorMessage(err).split('\n')[0]}`
		};
		if (typeof start?.line === 'number' && typeof start.column === 'number') {
			problem.line = start.line;
			problem.column = start.column + 1;
		}
		return { properties: [], problem };
	}
	const { css } = ast;
	if (!css) return noCss();

	const lineStarts = lineStartsOf(svelteSource);
	let lang: string | true | undefined;
	let type: string | true | undefined;
	for (const attribute of css.attributes) {
		if (attribute.name === 'lang') lang = attributeText(attribute);
		else if (attribute.name === 'type') type = attributeText(attribute);
	}
	const language = styleLanguageOf(lang, type);
	if (language !== undefined) {
		const line = lineAt(lineStarts, css.start);
		return {
			properties: [],
			problem: {
				kind: 'css_lang_unsupported',
				message: `The <style> is "${language}", not CSS, so the styling API isn't read.`,
				lang: language,
				line,
				column: css.start - lineStarts[line - 1]! + 1
			}
		};
	}

	const defined: Set<string> = new Set();
	const reads: Map<string, FirstRead> = new Map();
	collectStylesheet(css.children, svelteSource, defined, reads);
	if (reads.size === 0) return noCss();
	const setInMarkup: Set<string> = new Set();
	collectMarkupProperties(ast.fragment, setInMarkup);

	const properties: Array<ComponentCssPropertyJson> = [];
	for (const [name, { offset, fallback }] of reads) {
		if (fallback === undefined || defined.has(name) || setInMarkup.has(name)) continue;
		properties.push({ name, fallback, sourceLine: lineAt(lineStarts, offset) });
	}
	return { properties };
};
