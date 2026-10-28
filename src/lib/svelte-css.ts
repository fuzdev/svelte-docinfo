/**
 * A Svelte component's styling API: the CSS custom properties its styles
 * read with a fallback, or register with `@property`, and leave for a
 * consumer to set (`ComponentDeclarationJson.cssCustomProperties`).
 *
 * Svelte's own parser reads the component, with script content blanked, so
 * the stylesheet and the markup come from one parse: `ast.css` gives the
 * declarations and `@property` rules, and the template gives the `style:--x`
 * directives and `style` attributes that set properties internally, plus the
 * static style text the markup reads through. Declaration values are scanned
 * from the original source text (`scanCssVarReads`), since the parser strips
 * comments from them and gives no offsets inside them.
 *
 * `@cssprop` tags in the component's doc comment merge in afterwards
 * (`documentCssProperties`), checked against every read the component makes
 * and against the fallback the style gives.
 *
 * @internal
 *
 * @module
 */

import { parse, type AST } from 'svelte/compiler';

import { toErrorMessage } from './error.ts';
import { blankVerbatimContent, scanScriptTags } from './svelte-scripts.ts';
import { parseCsspropTagText, type TsdocCssProperty } from './tsdoc.ts';
import type { ComponentCssPropertyJsonInput } from './types.ts';

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
	/**
	 * Offsets of the fallback's text, after the comma up to the closing `)`,
	 * untrimmed; `undefined` for a read without one.
	 */
	fallbackRange: [start: number, end: number] | undefined;
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
		const hasFallback = text[afterName] === ',';
		reads.push({
			name,
			fallback: hasFallback ? text.slice(afterName + 1, close).trim() : undefined,
			offset: identStart,
			fallbackRange: hasFallback ? [afterName + 1, close] : undefined
		});
	}
	return reads;
};

/** Why a component's styling API wasn't read. */
export type ComponentCssProblem =
	| { kind: 'css_parse_failed'; message: string; line?: number; column?: number }
	| { kind: 'css_lang_unsupported'; message: string; lang: string; line: number; column: number };

/** A custom property the component reads somewhere, as `documentCssProperties` checks a tag. */
export interface ComponentCssRead {
	/** 1-based line of the first read in the original source, preferring an outermost one. */
	line: number;
	/**
	 * The value the property takes when a consumer doesn't set it: an
	 * `@property` rule's `initial-value`, else the first fallback any read
	 * gives, preferring an outermost one's.
	 */
	fallback: string | undefined;
	/** An `@property` rule's `syntax` for the name, quotes stripped. */
	syntax?: string;
}

/** What `analyzeComponentCss` reads from a component. */
export interface ComponentCss {
	/** The styling API, in the order of each name's first read. */
	properties: Array<ComponentCssPropertyJsonInput>;
	/**
	 * Every custom property the component reads through `var()`, by name: in
	 * its `<style>` at any nesting (`var(--a, var(--b))` reads both), and in
	 * the static text of its markup's `style` attributes, `style:` directives,
	 * and child components' `style` and `--a` attributes. Names the component
	 * sets itself included. `undefined` when the style wasn't read (`problem`).
	 */
	reads?: Map<string, ComponentCssRead>;
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

/** The `Text` parts of an attribute or directive value. */
// `StyleDirective['value']` includes every shape `Attribute['value']` takes
const textPartsOf = (value: AST.StyleDirective['value']): Array<AST.Text> =>
	Array.isArray(value) ? value.filter((part): part is AST.Text => part.type === 'Text') : [];

/** Keep the first read of `name`, filling a fallback it lacks from a later read's. */
const recordRead = <T extends { fallback?: string | undefined }>(
	reads: Map<string, T>,
	name: string,
	read: T
): void => {
	const first = reads.get(name);
	if (!first) reads.set(name, read);
	else if (first.fallback === undefined) first.fallback = read.fallback;
};

/** Record every `var()` read nested in a fallback range, at any depth, into `reads`. */
const collectNestedReads = (
	svelteSource: string,
	start: number,
	end: number,
	reads: Map<string, FirstRead>
): void => {
	for (const read of scanCssVarReads(svelteSource, start, end)) {
		recordRead(reads, read.name, { offset: read.offset, fallback: read.fallback });
		if (read.fallbackRange) {
			collectNestedReads(svelteSource, read.fallbackRange[0], read.fallbackRange[1], reads);
		}
	}
};

/** An outermost `var()` read, by name, where `scanCssVarReads` found it. */
interface NamedRead extends FirstRead {
	name: string;
}

/**
 * Collect the outermost `var()` reads in a source range into `reads` and the
 * ones nested in their fallbacks into `nestedReads`.
 */
const collectRangeReads = (
	svelteSource: string,
	start: number,
	end: number,
	reads: Array<NamedRead>,
	nestedReads: Map<string, FirstRead>
): void => {
	for (const read of scanCssVarReads(svelteSource, start, end)) {
		reads.push({ name: read.name, offset: read.offset, fallback: read.fallback });
		if (read.fallbackRange) {
			collectNestedReads(svelteSource, read.fallbackRange[0], read.fallbackRange[1], nestedReads);
		}
	}
};

/**
 * The custom properties the markup sets on the component's own elements:
 * `style:--a` directives and `--a:` in `style` attributes, on elements and
 * `<svelte:element>`, at any depth, into `names`. A child component's `--a`
 * or `style` attribute styles the child, so it sets nothing. Also every
 * `var()` the static text of those attributes and directives reads, a child
 * component's `style` and `--a` attributes included: the outermost reads into
 * `reads`, the ones nested in their fallbacks into `nestedReads`.
 */
const collectMarkupProperties = (
	fragment: AST.Fragment,
	svelteSource: string,
	names: Set<string>,
	reads: Array<NamedRead>,
	nestedReads: Map<string, FirstRead>
): void => {
	for (const node of fragment.nodes) {
		if (node.type === 'RegularElement' || node.type === 'SvelteElement') {
			for (const attribute of node.attributes) {
				if (attribute.type === 'StyleDirective') {
					if (attribute.name.startsWith('--')) names.add(attribute.name);
				} else if (attribute.type === 'Attribute' && attribute.name.toLowerCase() === 'style') {
					collectStyleAttributeProperties(attribute, names);
				} else continue;
				for (const part of textPartsOf(attribute.value)) {
					collectRangeReads(svelteSource, part.start, part.end, reads, nestedReads);
				}
			}
		} else if (node.type === 'Component' || node.type === 'SvelteComponent') {
			for (const attribute of node.attributes) {
				if (attribute.type !== 'Attribute') continue;
				// a component's props are case-sensitive, unlike an element's attributes
				if (!attribute.name.startsWith('--') && attribute.name !== 'style') continue;
				for (const part of textPartsOf(attribute.value)) {
					collectRangeReads(svelteSource, part.start, part.end, reads, nestedReads);
				}
			}
		}
		// every child fragment, whatever the node calls it (`fragment`, `body`,
		// `consequent`, `then`, …); expressions are never fragments
		for (const value of Object.values(node)) {
			if (value && typeof value === 'object' && (value as { type?: unknown }).type === 'Fragment') {
				collectMarkupProperties(value as AST.Fragment, svelteSource, names, reads, nestedReads);
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

/** What an `@property` rule registers for a custom property. */
interface RegisteredProperty {
	/** The `syntax` descriptor's value, its quotes stripped (`'<color>'` gives `<color>`). */
	syntax?: string;
	/** The `initial-value` descriptor's value, trimmed. */
	initialValue?: string;
}

/** A CSS string's content when `value` is one quoted string, else `value` as is. */
const unquoteCssString = (value: string): string => {
	const quote = value[0];
	return (quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)
		? value.slice(1, -1)
		: value;
};

/**
 * Collect the stylesheet's own custom property declarations into `defined`,
 * its `@property` rules into `registered`, its outermost `var()` reads into
 * `reads`, and the reads nested in their fallbacks into `nestedReads`, in
 * source order, at every depth: rules, nested rules, and at-rule blocks
 * (`@media`, keyframes, …). An `@property` rule's own descriptors aren't
 * reads; of several rules for one name the last wins, as in CSS.
 */
const collectStylesheet = (
	nodes: ReadonlyArray<CssNode>,
	svelteSource: string,
	defined: Set<string>,
	registered: Map<string, RegisteredProperty>,
	reads: Array<NamedRead>,
	nestedReads: Map<string, FirstRead>
): void => {
	for (const node of nodes) {
		if (node.type === 'Declaration') {
			if (node.property.startsWith('--')) defined.add(node.property);
			// the value read from the source, where comments and offsets survive
			collectRangeReads(
				svelteSource,
				node.start + node.property.length,
				node.end,
				reads,
				nestedReads
			);
		} else if (node.type === 'Atrule' && node.name.toLowerCase() === 'property') {
			const name = node.prelude.trim();
			if (!name.startsWith('--')) continue;
			const registration: RegisteredProperty = {};
			for (const child of node.block?.children ?? []) {
				if (child.type !== 'Declaration') continue;
				const property = child.property.toLowerCase();
				const value = child.value.trim();
				if (property === 'syntax') registration.syntax = unquoteCssString(value);
				else if (property === 'initial-value') registration.initialValue = value;
			}
			registered.set(name, registration);
		} else if (node.block) {
			collectStylesheet(node.block.children, svelteSource, defined, registered, reads, nestedReads);
		}
	}
};

const noCss = (): ComponentCss => ({ properties: [], reads: new Map() });

/** Matches text that may hold a `var()` read, case-insensitively as CSS does. */
const VAR_CALL = /var\(/i;

/**
 * Read a component's styling API: the custom properties its top-level
 * `<style>` and its markup's static style text read through an outermost
 * `var()` with a fallback, or that its style registers with `@property`,
 * minus the ones it sets itself. The policy is
 * `ComponentDeclarationJson.cssCustomProperties`'s.
 *
 * One parse with Svelte's parser (`modern`, `loose`) over the source with its
 * script content blanked, so script syntax never fails it. A style whose
 * `lang` or `type` names another language is blanked too, and reported as
 * `css_lang_unsupported`. A parse failure reports `css_parse_failed`, with
 * the parser's position. A source without `<style` text is parsed only when
 * its non-script text has `var(`, for its markup's reads; otherwise it reads
 * nothing, with empty `reads`. Every
 * read, the ones it doesn't list included, lands in `reads` for
 * `documentCssProperties`.
 *
 * @param svelteSource - the full Svelte source code
 * @returns the styling API, plus the problem when the style wasn't read
 */
export const analyzeComponentCss = (svelteSource: string): ComponentCss => {
	if (!svelteSource.includes('<style') && !VAR_CALL.test(svelteSource)) return noCss();
	const blanked = blankVerbatimContent(svelteSource, scanScriptTags(svelteSource), {
		keepStyle: (attributes) =>
			styleLanguageOf(attributes.get('lang'), attributes.get('type')) === undefined
	});
	// a style-less source is parsed only for its markup's reads, so `var(` in
	// a script string is no reason to parse it
	if (!svelteSource.includes('<style') && !VAR_CALL.test(blanked)) return noCss();
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
	const lineStarts = lineStartsOf(svelteSource);

	let lang: string | true | undefined;
	let type: string | true | undefined;
	for (const attribute of css?.attributes ?? []) {
		if (attribute.name === 'lang') lang = attributeText(attribute);
		else if (attribute.name === 'type') type = attributeText(attribute);
	}
	const language = styleLanguageOf(lang, type);
	if (css && language !== undefined) {
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
	const registered: Map<string, RegisteredProperty> = new Map();
	const outermost: Array<NamedRead> = [];
	const nestedReads: Map<string, FirstRead> = new Map();
	if (css)
		collectStylesheet(css.children, svelteSource, defined, registered, outermost, nestedReads);
	const setInMarkup: Set<string> = new Set();
	collectMarkupProperties(ast.fragment, svelteSource, setInMarkup, outermost, nestedReads);
	// one first-read order across the stylesheet and the markup
	outermost.sort((a, b) => a.offset - b.offset);
	const reads: Map<string, FirstRead> = new Map();
	for (const { name, offset, fallback } of outermost) recordRead(reads, name, { offset, fallback });

	// what a read of `name` resolves to: a registered property is never
	// unset, so its initial value is what the property takes, whatever the
	// read falls back to
	const toRead = (
		name: string,
		offset: number,
		readFallback: string | undefined
	): ComponentCssRead => {
		const registration = registered.get(name);
		return {
			line: lineAt(lineStarts, offset),
			fallback: registration?.initialValue ?? readFallback,
			...(registration?.syntax !== undefined && { syntax: registration.syntax })
		};
	};
	const properties: Array<ComponentCssPropertyJsonInput> = [];
	const allReads: Map<string, ComponentCssRead> = new Map();
	for (const [name, { offset, fallback: readFallback }] of reads) {
		const read = toRead(name, offset, readFallback);
		allReads.set(name, read);
		if (defined.has(name) || setInMarkup.has(name)) continue;
		if (read.fallback === undefined && !registered.has(name)) continue;
		properties.push({
			name,
			...(read.syntax !== undefined && { syntax: read.syntax }),
			...(read.fallback !== undefined && { fallback: read.fallback }),
			sourceLine: read.line
		});
	}
	for (const [name, { offset, fallback }] of nestedReads) {
		recordRead(allReads, name, toRead(name, offset, fallback));
	}
	return { properties, reads: allReads };
};

/** What `documentCssProperties` makes of a component's `@cssprop` tags. */
export interface DocumentedComponentCss {
	/** The styling API with the documented properties merged in. */
	properties: Array<ComponentCssPropertyJsonInput>;
	/** The documented entries the component never reads, at their tags' lines, in tag order. */
	unread: Array<ComponentCssPropertyJsonInput>;
	/** The documented entries whose tag default disagrees with the style's fallback, in tag order. */
	mismatched: Array<ComponentCssPropertyJsonInput>;
}

/** Whether two CSS values are the same text, whitespace runs aside. */
const cssValuesEqual = (a: string, b: string): boolean =>
	a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

/**
 * Merge a component's `@cssprop` tags into its styling API
 * (`ComponentDeclarationJson.cssCustomProperties`, whose policy this is).
 *
 * Each tag is an entry, `documented: true`, in tag order, ahead of the
 * listed undocumented reads, which keep their first-read order. The tag
 * gives `description`, `syntax`, and `default`; the style gives `fallback`
 * and `sourceLine`, so the two never overwrite each other. A tagged name the
 * component reads takes the read's line and fallback: the listed entry's when
 * the heuristic found the name, else the first read's anywhere
 * (`ComponentCss.reads`: a bare read, one nested in another's fallback, one
 * in the markup's static style text, or one of a name the component sets
 * itself). A read name's `@property` `syntax` stays when the tag gives none.
 * A tagged name the component never reads is kept at its tag's
 * line and reported in `unread`; a tag default that disagrees with the
 * fallback, whitespace runs aside, is reported in `mismatched`. When the
 * style wasn't read (`ComponentCss.problem`), every tag is kept at its tag's
 * line and nothing is reported.
 *
 * @param css - the component's styling API as `analyzeComponentCss` read it
 * @param tags - the component doc comment's `@cssprop` tags
 * @param tagLineOf - the 1-based line of a tag in the original source, by name
 */
export const documentCssProperties = (
	css: ComponentCss,
	tags: ReadonlyArray<TsdocCssProperty>,
	tagLineOf: (name: string) => number
): DocumentedComponentCss => {
	if (tags.length === 0) return { properties: css.properties, unread: [], mismatched: [] };
	const listed = new Map(css.properties.map((property) => [property.name, property]));
	const properties: Array<ComponentCssPropertyJsonInput> = [];
	const unread: Array<ComponentCssPropertyJsonInput> = [];
	const mismatched: Array<ComponentCssPropertyJsonInput> = [];
	for (const tag of tags) {
		const entry = listed.get(tag.name);
		const read = entry
			? { line: entry.sourceLine, fallback: entry.fallback, syntax: entry.syntax }
			: css.reads?.get(tag.name);
		const syntax = tag.syntax ?? read?.syntax;
		const property: ComponentCssPropertyJsonInput = {
			name: tag.name,
			...(tag.description !== undefined && { description: tag.description }),
			...(syntax !== undefined && { syntax }),
			...(read?.fallback !== undefined && { fallback: read.fallback }),
			...(tag.default !== undefined && { default: tag.default }),
			sourceLine: read ? read.line : tagLineOf(tag.name),
			documented: true
		};
		properties.push(property);
		if (!read && css.reads) unread.push(property);
		if (
			tag.default !== undefined &&
			read?.fallback !== undefined &&
			!cssValuesEqual(tag.default, read.fallback)
		) {
			mismatched.push(property);
		}
	}
	const documented = new Set(tags.map(({ name }) => name));
	for (const property of css.properties) {
		if (!documented.has(property.name)) properties.push(property);
	}
	return { properties, unread, mismatched };
};

/**
 * A line-leading `@cssprop` (or `@cssproperty`) tag: first on its line but
 * for whitespace and a comment opener (`<!--`, `/**`, or a JSDoc `*`).
 */
const CSSPROP_TAG = /^[ \t]*(?:<!--|\/\*\*|\*)?[ \t]*@css(?:prop|property)\b/gm;

/** A line-leading tag of any name, where a tag's text ends. */
const ANY_TAG_LINE = /^[ \t]*(?:<!--|\/\*\*|\*)?[ \t]*@[a-z]/im;

/** A JSDoc or HTML comment line's leading ` * `, and a comment closer. */
const LINE_PREFIX = /^[ \t]*\*?[ \t]?/;
const COMMENT_CLOSER = /\*\/|-->/;

/**
 * The text of the tag at `tagEnd` (just past its name) as the comment parser
 * reads it: the rest of its line and the lines after it up to the next
 * line-leading tag or the comment's closer, the lines' comment prefixes
 * stripped.
 */
const csspropTagText = (text: string, tagEnd: number): string => {
	const rest = text.slice(tagEnd);
	const firstLineEnd = rest.indexOf('\n');
	let end = rest.length;
	if (firstLineEnd !== -1) {
		const nextTag = ANY_TAG_LINE.exec(rest.slice(firstLineEnd + 1));
		if (nextTag) end = firstLineEnd + 1 + nextTag.index;
	}
	const closer = COMMENT_CLOSER.exec(rest.slice(0, end));
	if (closer) end = closer.index;
	return rest
		.slice(0, end)
		.split('\n')
		.map((line, i) => (i === 0 ? line : line.replace(LINE_PREFIX, '')))
		.join('\n');
};

/**
 * The 1-based line, in the original source, of a `@cssprop` tag in a range
 * of it (the doc comment the tags came from): the `occurrence`th tag, from
 * zero, that names `name`, or with `name` undefined, that names nothing (a
 * malformed tag).
 *
 * Tags are matched by text, line-leading only, so a mention later in a line
 * (a `//` comment citing the tag, or a backticked one in prose) never takes
 * the tag's place, and a tag written mid-line, which TS still reads, isn't
 * found, leaving the caller's fallback line. A line-leading mention ahead of
 * the tag can still take its place. A tag's text runs to the next
 * line-leading tag, as the comment parser reads it (`csspropTagText`), so a
 * name on the line after the tag and a default spanning lines parse as the
 * tag does (`parseCsspropTagText`).
 *
 * @param svelteSource - the full Svelte source code
 * @param start - offset where the comment starts
 * @param end - offset where the comment ends
 * @param name - the documented property's name, or `undefined` for a malformed tag
 * @param occurrence - which matching tag, from zero (the second tag naming
 *   `name` is `1`)
 * @returns the line, or `undefined` when the range holds no such tag
 */
export const findCsspropTagLine = (
	svelteSource: string,
	start: number,
	end: number,
	name: string | undefined,
	occurrence = 0
): number | undefined => {
	const text = svelteSource.slice(start, end);
	let remaining = occurrence;
	for (const match of text.matchAll(CSSPROP_TAG)) {
		if (parseCsspropTagText(csspropTagText(text, match.index + match[0].length))?.name !== name) {
			continue;
		}
		if (remaining-- > 0) continue;
		// one lookup, so count newlines rather than index every line start
		let line = 1;
		for (let i = start + match.index; i-- > 0;) {
			if (svelteSource.charCodeAt(i) === 10 /* \n */) line++;
		}
		return line;
	}
	return undefined;
};
