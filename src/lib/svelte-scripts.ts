/**
 * Locating a Svelte component's script tags: its instance `<script>` and its
 * `<script module>`.
 *
 * Svelte takes a `<script>` for one of those only at the top level of the
 * file. Nested in an element, a block, or `<svelte:head>` it's an ordinary
 * element (a JSON-LD block, an inline analytics snippet), and its content says
 * nothing about the component. So finding the tags takes two steps: a regex
 * scan for candidates (`scanScriptTags`), then a decision about which of
 * them are top-level (`findScriptTags`).
 *
 * @internal
 *
 * @module
 */

import { parse } from 'svelte/compiler';

/** A located script tag: parsed attributes, content, and where the content starts in the source. */
export interface SvelteScriptTag {
	/** Opening-tag attributes; bare attributes (`module`) map to `true`. */
	attributes: Map<string, string | true>;
	content: string;
	/** Offset of `content` within the source, for mapping script positions to original lines. */
	start: number;
}

/** A script tag the scan matched, before anything has decided whether it's top-level. */
export interface ScannedScriptTag extends SvelteScriptTag {
	/** Offset of the tag's opening `<`, which is where Svelte's parser places the script. */
	open: number;
	/** Offset just past the tag's closing `>`. */
	end: number;
	/**
	 * Whether the scan alone proves the tag top-level, with no parser: see
	 * `scanScriptTags` for the proof and its conditions.
	 */
	provenTopLevel: boolean;
}

/**
 * Matches, left to right, an HTML comment or a script tag.
 *
 * Ports Svelte's preprocessor regex (`svelte/src/compiler/preprocess`):
 * quote-aware attributes (`>` inside a value doesn't end the tag),
 * commented-out scripts consumed by the comment alternative, a self-closing
 * form with no content. Adaptations: the `d` flag for content offsets, no `i`
 * flag (`<Script>` is a component), `\s*` before the closing `>` per the
 * parser's `/<\/script\s*>/`.
 */
const SCRIPT_TAG_MATCHER =
	/<!--[^]*?-->|<script((?:\s+[^=>'"/\s]+=(?:"[^"]*"|'[^']*'|[^>\s]+)|\s+[^=>'"/\s]+)*\s*)(?:\/>|>([^]*?)<\/script\s*>)/dg;

/** `SCRIPT_TAG_MATCHER` for style tags, whose content is blanked before parsing. */
const STYLE_TAG_MATCHER =
	/<!--[^]*?-->|<style(?:\s+[^=>'"/\s]+=(?:"[^"]*"|'[^']*'|[^>\s]+)|\s+[^=>'"/\s]+)*\s*>([^]*?)<\/style\s*>/dg;

/**
 * The attribute spellings the scan's proof accepts: names of word characters,
 * values double-quoted, single-quoted, or bare word characters, whitespace
 * between attributes. Narrower than `SCRIPT_TAG_MATCHER`'s attribute branch
 * on purpose. That branch can backtrack into a second reading of the same
 * text (an unterminated quote read as a bare value), and Svelte's parser,
 * which never backtracks, may take the other one. This grammar has a single
 * reading, the one the parser's `read_static_attribute` makes.
 */
const UNAMBIGUOUS_ATTRIBUTES_MATCHER =
	/^(?:[ \t\r\n]+[A-Za-z][\w-]*(?:=(?:"[^"]*"|'[^']*'|[\w.-]+))?)*[ \t\r\n]*$/;

const WHITESPACE_MATCHER = /\s*/y;

/** Whether `source` holds only whitespace from `start` up to `end`. */
const isWhitespaceBetween = (source: string, start: number, end: number): boolean => {
	WHITESPACE_MATCHER.lastIndex = start;
	WHITESPACE_MATCHER.test(source);
	return WHITESPACE_MATCHER.lastIndex >= end;
};

/**
 * Scan Svelte source for script tags with content, in source order, and mark
 * the ones the scan itself proves top-level.
 *
 * The scan is syntactic and knows nothing about nesting, so it returns nested
 * tags too; `findScriptTags` is the function that answers which are the
 * component's. Limits: whitespace around an attribute `=` makes a tag
 * unmatchable (Svelte rejects one of those spellings, and svelte2tsx matches
 * neither), and `</script>` in a string literal ends the content early.
 *
 * **`provenTopLevel`** holds for a tag when everything from the start of the
 * file to it is whitespace, complete HTML comments, and earlier script tags
 * that are themselves proven. Svelte's parser reads each of those at the root
 * and comes back to the root: whitespace is text, a comment runs to the first
 * `-->`, and a top-level script runs from its opening tag to the first
 * `</script>`, the same extents the regex matched. So it meets this tag at the
 * root, where a `<script>` is the instance or module script.
 *
 * Anything that would need more than that argument leaves the tag unproven,
 * along with every tag after it:
 *
 * - any other text or markup before the tag: a `<style>`,
 *   `<svelte:options>`, an unterminated comment, what's left over when a
 *   `</script>` in a string ended an earlier match early, and tags the regex
 *   doesn't match (`<SCRIPT>`, a spelling with whitespace around `=`)
 * - a self-closing `<script />`, which Svelte's parser rejects at the top
 *   level
 * - attributes outside `UNAMBIGUOUS_ATTRIBUTES_MATCHER`
 */
export const scanScriptTags = (svelteSource: string): Array<ScannedScriptTag> => {
	const scripts: Array<ScannedScriptTag> = [];
	// whether everything up to `cursor` is whitespace, comments, and proven scripts
	let atRoot = true;
	let cursor = 0;
	SCRIPT_TAG_MATCHER.lastIndex = 0;
	let match;
	while ((match = SCRIPT_TAG_MATCHER.exec(svelteSource)) !== null) {
		atRoot &&= isWhitespaceBetween(svelteSource, cursor, match.index);
		cursor = match.index + match[0].length;
		const attrs = match[1];
		// the comment alternative captures no attributes
		if (attrs === undefined) continue;
		const content = match[2];
		if (content === undefined) {
			// self-closing, so no content to return
			atRoot = false;
			continue;
		}
		atRoot &&= UNAMBIGUOUS_ATTRIBUTES_MATCHER.test(attrs);
		scripts.push({
			attributes: parseAttributes(attrs),
			content,
			start: match.indices![2]![0],
			open: match.index,
			end: cursor,
			provenTopLevel: atRoot
		});
	}
	return scripts;
};

/**
 * Parse an opening-tag attribute string into a name → value map — bare
 * attributes map to `true`. The token grammar mirrors `SCRIPT_TAG_MATCHER`'s
 * attribute branch, so anything that regex matched parses cleanly here.
 */
const parseAttributes = (attrs: string): Map<string, string | true> => {
	const attributes: Map<string, string | true> = new Map();
	const attributeRegex = /([^=>'"/\s]+)(?:=(?:"([^"]*)"|'([^']*)'|([^>\s]+)))?/g;
	let match;
	while ((match = attributeRegex.exec(attrs)) !== null) {
		attributes.set(match[1]!, match[2] ?? match[3] ?? match[4] ?? true);
	}
	return attributes;
};

/**
 * A script tag is a module script when it carries a `module` attribute
 * (Svelte 5) or `context="module"` (Svelte 4) — Svelte's `read_script` test,
 * minus its error paths. `module` inside an attribute *value* doesn't count.
 */
export const isModuleScript = (attributes: Map<string, string | true>): boolean =>
	attributes.has('module') || attributes.get('context') === 'module';

/**
 * Copy `svelteSource` with the content of its script and style tags
 * overwritten by spaces, newlines kept, so every offset and line still means
 * what it meant. Script content needn't be JavaScript Svelte's parser accepts,
 * and a nested tag's content would be read as template.
 *
 * A style tag that opens inside a script tag is text in that script, and the
 * search for styles resumes after the script. A leading byte-order mark
 * becomes a space too: Svelte's `parse` strips one, which would shift every
 * offset it reports.
 */
const blankVerbatimContent = (
	svelteSource: string,
	scripts: ReadonlyArray<ScannedScriptTag>
): string => {
	const ranges: Array<[start: number, end: number]> = scripts.map((tag) => [
		tag.start,
		tag.start + tag.content.length
	]);
	STYLE_TAG_MATCHER.lastIndex = 0;
	let match;
	while ((match = STYLE_TAG_MATCHER.exec(svelteSource)) !== null) {
		const range = match.indices![1];
		// the comment alternative captures no content
		if (!range) continue;
		const open = match.index;
		const enclosing = scripts.find((tag) => tag.open < open && open < tag.end);
		if (enclosing) {
			STYLE_TAG_MATCHER.lastIndex = enclosing.end;
			continue;
		}
		ranges.push(range);
	}
	// a style's content can hold a matched script, so ranges can overlap: each
	// is clipped to what's still ahead of the cursor
	ranges.sort((a, b) => a[0] - b[0]);

	let blanked = '';
	let cursor = 0;
	if (svelteSource.charCodeAt(0) === 0xfeff) {
		blanked = ' ';
		cursor = 1;
	}
	for (const [rangeStart, end] of ranges) {
		const start = Math.max(rangeStart, cursor);
		if (end <= start) continue;
		blanked +=
			svelteSource.slice(cursor, start) + svelteSource.slice(start, end).replace(/[^\n]/g, ' ');
		cursor = end;
	}
	return blanked + svelteSource.slice(cursor);
};

/** The part of Svelte's parsed root that `findScriptTags` reads. */
export interface SvelteTemplateScripts {
	/** The instance script, at the offset of its opening `<`. */
	instance?: { start: number } | null;
	/** The module script, at the offset of its opening `<`. */
	module?: { start: number } | null;
}

/**
 * Parses a Svelte source whose script and style content is blanked, and says
 * where its top-level scripts are. Throws when the source doesn't parse.
 */
export type ParseSvelteTemplate = (blankedSource: string) => SvelteTemplateScripts;

/**
 * The default `ParseSvelteTemplate`: Svelte's own parser. `loose` keeps it
 * from throwing on a template error, the way svelte2tsx parses under
 * `emitOnTemplateError`; `modern` skips the conversion to the legacy AST.
 */
const parseSvelteTemplate: ParseSvelteTemplate = (blankedSource) =>
	parse(blankedSource, { modern: true, loose: true });

/**
 * How `findScriptTags` decided which tags are top-level:
 *
 * - `'scan'` — the scan proved every tag top-level (`provenTopLevel`), so
 *   nothing was parsed
 * - `'parser'` — Svelte's parser said which tags are the instance and module
 *   scripts
 * - `'unparsed'` — the parser threw, and every matched tag is returned
 */
export type ScriptTagsDecision = 'scan' | 'parser' | 'unparsed';

/** What `findScriptTags` returns. */
export interface FoundScriptTags {
	/** The component's script tags, in source order. */
	tags: Array<SvelteScriptTag>;
	decidedBy: ScriptTagsDecision;
}

/** Options for `findScriptTags`. */
export interface FindScriptTagsOptions {
	/**
	 * Take the scan's proof when it covers every tag, without parsing.
	 * `false` sends every source with a tag to the parser.
	 *
	 * @default true
	 */
	scanProof?: boolean;
	/** The parser asked about tags the scan can't prove. Defaults to Svelte's. */
	parseTemplate?: ParseSvelteTemplate;
}

const toScriptTag = ({ attributes, content, start }: ScannedScriptTag): SvelteScriptTag => ({
	attributes,
	content,
	start
});

/**
 * Find a component's script tags: the `<script>` tags at the top level of the
 * source, in source order. A `<script>` nested in an element, a block, or
 * `<svelte:head>` isn't one, matching Svelte, which reads only a top-level
 * tag as the instance or module script.
 *
 * `scanScriptTags` finds the candidates. When it proves every one of them
 * top-level, which covers the usual component with its scripts ahead of the
 * template, that's the answer. Otherwise Svelte's parser decides: the source
 * is parsed with script and style content blanked, and the tags at the
 * offsets of the root's `instance` and `module` are kept. svelte2tsx parses
 * the same blanked source, but demotes only the tags the parser reads as
 * nested elements, so a tag spelled inside an expression string or an
 * attribute value is still a script to it and isn't one here.
 *
 * Limits: a `</script>` or `</style>` inside a string or comment ends that
 * tag's blanked content early, and what's left over is parsed as template.
 * And svelte2tsx's own tag matcher is narrower in one spelling: it doesn't
 * take a closing tag with whitespace before the `>` (`</script >`), so there
 * its virtual doesn't have the scripts as written while this returns them. A
 * legacy component
 * written that way documents no props, with a `svelte_prop_failed` warning
 * for each `export let`; a runes one documents none, with no warning.
 *
 * @param svelteSource - the full Svelte source code
 * @returns the top-level script tags and how they were decided
 */
export const findScriptTags = (
	svelteSource: string,
	options?: FindScriptTagsOptions
): FoundScriptTags => {
	const scripts = scanScriptTags(svelteSource);
	if (scripts.length === 0) return { tags: [], decidedBy: 'scan' };
	if (options?.scanProof !== false && scripts.every((tag) => tag.provenTopLevel)) {
		return { tags: scripts.map(toScriptTag), decidedBy: 'scan' };
	}
	const parseTemplate = options?.parseTemplate ?? parseSvelteTemplate;
	let parsed: SvelteTemplateScripts;
	try {
		parsed = parseTemplate(blankVerbatimContent(svelteSource, scripts));
	} catch (_) {
		// Every matched tag, nested ones included: the answer the scan alone
		// gives. Svelte's parser throws here on a template error when it predates
		// `loose` parsing (Svelte 5.13), which the peer range (5.0 and up) still
		// admits, and in any version on the few errors `loose` doesn't absorb.
		// TODO: remove this fallback when the `svelte` peer floor reaches a
		// version with `loose` parsing
		return { tags: scripts.map(toScriptTag), decidedBy: 'unparsed' };
	}
	const topLevel = new Set([parsed.instance?.start, parsed.module?.start]);
	return {
		tags: scripts.filter((tag) => topLevel.has(tag.open)).map(toScriptTag),
		decidedBy: 'parser'
	};
};
