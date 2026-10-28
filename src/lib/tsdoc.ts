/**
 * TSDoc/JSDoc parsing helpers using the TypeScript compiler API.
 *
 * Provides `parseComment` for extracting JSDoc/TSDoc from TypeScript nodes.
 * Primarily designed for build-time code generation but can be used at runtime.
 *
 * ## Design
 *
 * Pure extraction approach: extracts documentation as-is with minimal transformation,
 * preserving source intent. Works around TypeScript compiler API quirks where needed.
 *
 * Supports both regular TypeScript and Svelte components (via svelte2tsx output).
 *
 * ## Tag support
 *
 * Supports the common JSDoc/TSDoc doc tags as used across the TypeScript ecosystem:
 * `@param`, `@returns`, `@throws`, `@example`, `@deprecated`, `@internal`, `@see`,
 * `@since`, `@default`, `@nodocs`.
 * Where the two standards spell a tag differently, both spellings are accepted:
 * `@return` (JSDoc synonym) parses like `@returns`, and `@defaultValue` (the TSDoc
 * spelling, plus JSDoc's lowercase `@defaultvalue` synonym) parses like `@default`.
 *
 * `@internal` is a marker, not an exclusion: it means "not stable public API"
 * and lands as `internalMessage` (with any trailing prose; empty string for a
 * bare tag) while the declaration stays documented. `@nodocs` excludes a
 * declaration from documentation and flat-namespace validation — it's still
 * exported and usable, just not documented.
 *
 * Also supports `@mutates` (non-standard) for documenting mutations to parameters or external state.
 * Format: `@mutates target - description of mutation` — the target is everything before the
 * first ` - ` separator. It is unvalidated: typically a parameter name, but compound paths
 * (`this.foo`, `obj.field`) and multi-word external references are accepted; backticks are
 * stripped from the target so `` `a` `` and `a` are one key. Without a separator the first
 * line is a bare target (empty description) and any continuation lines are the description.
 *
 * Also supports `@cssprop` (the Custom Elements Manifest convention; `@cssproperty` is a
 * synonym) for documenting a Svelte component's CSS custom properties:
 * `@cssprop {<syntax>} [--name=default] - description`, where the braced syntax, the
 * brackets, and the default are optional (`parseCsspropTagText`). It documents only a
 * component, in its doc comment; elsewhere it warns `misplaced_tag`. A tag whose text
 * names no custom property, and a tag repeating an earlier tag's name, are kept apart in
 * `cssPropertyProblems` for the analyzers to warn about (`malformed_tag`, `duplicate_tag`);
 * they still count as doc content, so a comment of broken tags alone claims the doc slot
 * and gets its warnings.
 *
 * The `@see` tag supports multiple formats: plain URLs (`https://...`), `{@link}` syntax, and module names.
 * Relative/absolute path support in `@see` is TBD.
 *
 * ## Behavioral notes
 *
 * `@module` blocks are excluded from `parseComment` (see there). Module
 * comments go through the same parser by text: `parseModuleComment` rewraps a
 * module comment, from TS or either Svelte form, as a JSDoc block without its
 * `@module` line, and `toModuleDocFields` keeps the tags a module can carry.
 *
 * `JSDocPropertyLikeTag` nodes (`@property`/`@param` declaring a symbol in a
 * typedef or callback) parse to their own tag description — the only doc such
 * a declaration can carry.
 *
 * `@typedef`/`@callback` tags declare type aliases in JS. A block declaring one
 * without a `@param` or `@returns` is a typedef block (`isTypedefBlock`). As
 * in TypeScript's hover, the declaration it's attached to skips it. Its
 * typedef takes the block's prose and tags (hover shows no block tags on a
 * typedef) unless the block declares several (`typedefOwnsBlock`), and a
 * function doc block stays the function's, leaving a typedef in it only its
 * own tag comment; both are stricter than hover, which gives every typedef
 * the block's prose. A `@callback`'s `JSDocSignature` parses to its
 * `@param`/`@returns` text. Comment text parsed without a node
 * (`parseCommentText`) and the in-script component JSDoc keep a typedef
 * block's prose (`skipTypedefBlocks: false`).
 *
 * Due to TS Compiler API limitations:
 * - TS API includes dash separator in `@param` tag text; we strip the leading `- ` as it's syntax, not content
 * - `@throws` braced types (`{TypeError}`) parse into the tag's typeExpression, not its text —
 *   the type is read from there; unbraced text falls back to a first-word-as-type regex
 * - TS API strips URL protocols from `@see` tag text; we use `getText()` to preserve original format including `{@link}` syntax
 *
 * @see `declaration-build.ts` for `DeclarationJsonBuild`
 * @see `typescript-exports.ts` and `svelte.ts` as primary consumers
 *
 * @module
 */

import ts from 'typescript';

import type { DeclarationJsonBuild, MemberJsonBuild } from './declaration-build.ts';
import type { ModuleJsonInput } from './types.ts';

/**
 * Parsed JSDoc/TSDoc comment with structured metadata.
 *
 * Returned by `parseComment` — consumers typically pass this to `applyToDeclaration`
 * to populate `DeclarationJsonBuild` fields.
 */
export interface TsdocParsedComment {
	/** Comment text (excluding comment markers). */
	text: string;
	/** Parameter descriptions mapped by parameter name. */
	params: Record<string, string>;
	/** Return value description from `@returns` (or its JSDoc `@return` synonym). */
	returns?: string;
	/** Thrown errors from `@throws`. */
	throws?: Array<{ type?: string; description: string }>;
	/** Code examples from `@example`. */
	examples?: Array<string>;
	/** Deprecation message from `@deprecated`. */
	deprecatedMessage?: string;
	/**
	 * Internal-API marker from `@internal`. Presence means the tag was written;
	 * an empty string is a bare tag with no trailing prose. Means "not stable
	 * public API" — the declaration is still documented (use `@nodocs` to
	 * exclude from output).
	 */
	internalMessage?: string;
	/** Related references from `@see`. */
	seeAlso?: Array<string>;
	/** Version information from `@since`. */
	since?: string;
	/** Default value from `@default` (or its `@defaultValue`/`@defaultvalue` spellings). */
	defaultValue?: string;
	/**
	 * Mutation documentation from `@mutates` (non-standard), mapped by target —
	 * typically a parameter name, possibly a compound path (`this.foo`) or a
	 * multi-word external reference. Empty string for a bare tag with no description.
	 */
	mutates?: Record<string, string>;
	/** Whether to exclude from documentation. From `@nodocs` tag. */
	nodocs?: boolean;
	/**
	 * CSS custom properties from `@cssprop` (or its `@cssproperty` synonym), in
	 * tag order, one per name: a later tag naming the same property is ignored
	 * (`cssPropertyProblems` records it).
	 */
	cssProperties?: Array<TsdocCssProperty>;
	/**
	 * The `@cssprop` tags that document nothing, in tag order: one whose text
	 * names no custom property (`malformed`), and one naming a property an
	 * earlier tag already documents (`duplicate`). They count as doc content
	 * (`hasDocContent`), so a comment of broken tags alone still reaches the
	 * analyzer that warns about them.
	 */
	cssPropertyProblems?: Array<TsdocCssPropertyProblem>;
}

/** A `@cssprop` tag that documents nothing, for the analyzers to warn about. */
export interface TsdocCssPropertyProblem {
	/** `malformed` when the text names no custom property, `duplicate` when it repeats a name. */
	kind: 'malformed' | 'duplicate';
	/** The tag's text after the tag name, trimmed. */
	text: string;
	/** The repeated name, on a `duplicate`. */
	name?: string;
}

/**
 * A CSS custom property documented by a `@cssprop` tag
 * (`@cssprop {<color>} [--a=red] - Description 1`).
 */
export interface TsdocCssProperty {
	/** The property's name as written, `--` included. */
	name: string;
	/** The tag's description, without its leading `- ` separator. */
	description?: string;
	/** The braced syntax before the name (`<color>`), verbatim without the braces. */
	syntax?: string;
	/** The bracketed default after the name (`[--a=red]` → `red`), verbatim and trimmed. */
	default?: string;
}

/**
 * Clean TSDoc tag description text by stripping leading `- ` separator.
 * TSDoc syntax uses `- ` as a separator, but it shouldn't be part of the description content.
 * Only strips the first `- ` to preserve markdown lists later in the text.
 *
 * @param text - the tag text to clean
 * @returns cleaned text with leading `- ` removed if present
 */
const cleanTagDescription = (text: string): string => text.trim().replace(/^-\s+/, '');

/**
 * Parse an `@mutates` tag's text into target and description.
 *
 * The target is everything before the first ` - ` separator — a parameter
 * name, a compound path (`this.foo`, `obj.field`), or a multi-word external
 * reference — with backticks stripped so `` `a` `` and `a` normalize to one
 * key (matching `params` keys) and renderers apply their own code styling.
 * Without a separator the first line is a bare target (empty description)
 * and any continuation lines are the description.
 *
 * @returns target and description, or undefined when no target remains after stripping
 */
const parseMutatesTag = (text: string): { target: string; description: string } | undefined => {
	const cleaned = text.trim();
	const match = /^(.+?)\s+-\s+([\s\S]+)$/.exec(cleaned);
	let rawTarget: string;
	let description: string;
	if (match) {
		rawTarget = match[1]!;
		// the regex consumed the separator, so a leading `- ` here is
		// content (a markdown list bullet) — trim only, no strip
		description = match[2]!.trim();
	} else {
		const newlineIndex = cleaned.indexOf('\n');
		rawTarget = newlineIndex === -1 ? cleaned : cleaned.slice(0, newlineIndex);
		description = newlineIndex === -1 ? '' : cleaned.slice(newlineIndex + 1).trim();
	}
	const target = rawTarget.replaceAll('`', '').trim();
	return target ? { target, description } : undefined;
};

/**
 * The text of a JSDoc comment or tag comment, inline `{@link}` tags included
 * as written. `ts.getTextOfJSDocComment` reprints each link instead, and its
 * reprint of a link whose target isn't an entity name (`{@link ./x.ts}`, a bare
 * `{@link}`) adds a space (`{@link  ./x.ts}`); the source text is the author's.
 * A link that spans lines is joined onto one.
 */
const jsdocCommentText = (
	comment: string | ts.NodeArray<ts.JSDocComment> | undefined,
	sourceFile: ts.SourceFile
): string | undefined => {
	if (typeof comment !== 'object') return comment;
	return comment
		.map((part) =>
			// a kind check: `ts.isJSDocText` is typed but not exported at runtime
			part.kind === ts.SyntaxKind.JSDocText
				? part.text
				: part.getText(sourceFile).replace(/\s*\n\s*\*?\s*/g, ' ')
		)
		.join('');
};

/**
 * Whether a JSDoc block is a module-level comment: it has a `@module` line,
 * the rule `hasModuleTag` applies to cleaned text. TypeScript parses a tag at
 * any `@` after whitespace, so a mid-line mention (`` `<!-- @module -->` ``)
 * is a `module` tag to it; counting that would make the block neither a
 * module comment nor its declaration's doc.
 */
const isModuleJsdocBlock = (jsdoc: ts.JSDoc): boolean => {
	const tags = jsdoc.tags?.filter((tag) => tag.tagName.text === 'module');
	if (!tags?.length) return false;
	const text = jsdoc.getSourceFile().text;
	// the block's first content position, past its `/**`
	const contentStart = jsdoc.getStart() + 3;
	return tags.some((tag) => {
		// only whitespace around one `*` margin may sit between the line start
		// and the tag, as `cleanComment` strips one `*` per line
		let i = tag.getStart() - 1;
		const skipWhitespace = (): void => {
			while (i >= contentStart && (text[i] === ' ' || text[i] === '\t')) i--;
		};
		skipWhitespace();
		if (i >= contentStart && text[i] === '*') i--;
		skipWhitespace();
		return i < contentStart || text[i] === '\n' || text[i] === '\r';
	});
};

/**
 * Whether a JSDoc node or tag belongs to a module-level (`@module`) block.
 *
 * A module comment physically precedes the file's first statement, so the AST
 * attaches it to that statement's JSDoc — without this filter the module
 * comment (including tags like `@nodocs`) would read as the statement's own
 * docs. Per-block, so a statement's own JSDoc below a module comment still
 * applies. Module comments parse separately, through `parseModuleComment`.
 */
const belongsToModuleBlock = (node: ts.JSDoc | ts.JSDocTag): boolean =>
	ts.isJSDoc(node)
		? isModuleJsdocBlock(node)
		: ts.isJSDoc(node.parent) && isModuleJsdocBlock(node.parent);

/**
 * Record a `@param` tag's description under its written name, then recurse
 * into the property tags TypeScript nested beneath it.
 *
 * A parent typed `{object}`, `{Object}`, or an array of either
 * (`@param {object} opts`) makes the parser fold the contiguous dotted tags
 * that follow (`@param {string} opts.name`) into the parent's
 * `JSDocTypeLiteral` (`jsDocPropertyTags`, recursively for `opts.a.b` under a
 * braced `opts.a`), where `getJSDocTags` never reaches them. The nested tags
 * keep their full written name (`opts.a.b`, `arr[].name`), so they key
 * exactly as the unbraced, unnested form does. In `.ts` files too: the
 * nesting is the JSDoc parser's, independent of the language.
 *
 * @mutates params - adds one key per described tag, nested ones included
 */
const collectParamTag = (
	tag: ts.JSDocPropertyLikeTag,
	params: Record<string, string>,
	sourceFile: ts.SourceFile
): void => {
	const paramName = ts.isIdentifier(tag.name) ? tag.name.text : tag.name.getText(sourceFile);
	const tagText = jsdocCommentText(tag.comment, sourceFile);
	if (paramName && tagText) {
		params[paramName] = cleanTagDescription(tagText);
	}
	const typeNode = tag.typeExpression?.type;
	if (typeNode && ts.isJSDocTypeLiteral(typeNode)) {
		for (const nested of typeNode.jsDocPropertyTags ?? []) {
			collectParamTag(nested, params, sourceFile);
		}
	}
};

/**
 * The default a bracketed `@param` tag writes (`@param {number} [b=0]` →
 * `0`), verbatim source text with quotes kept, matching an initializer's
 * `defaultValue`. TypeScript's JSDoc parser reads the `= …` expression and
 * discards it, so the text is sliced from the source: from the `=` after the
 * name to the bracket that closes the name, skipping brackets and quoted
 * strings inside the default (`[b=[1, 2]]`, `[b='a]']`). A multi-line
 * default drops each continuation line's `*` margin. A regex literal
 * containing `]` isn't recognized (`[c=/]/]` reads as `/`). Callers use it
 * only for an omittable parameter: a bracket on a non-omittable one (a TS
 * `b: number` with no `?`) is ignored.
 *
 * @returns the default's text, or `undefined` when the tag writes none
 */
export const jsdocParamTagDefault = (
	tag: ts.JSDocParameterTag,
	sourceFile: ts.SourceFile = tag.getSourceFile()
): string | undefined => {
	if (!tag.isBracketed) return undefined;
	const text = sourceFile.text;
	let i = tag.name.end;
	while (i < tag.end && /\s/.test(text[i]!)) i++;
	if (text[i] !== '=') return undefined;
	const start = i + 1;
	let depth = 0;
	let quote: string | undefined;
	for (i = start; i < tag.end; i++) {
		const char = text[i]!;
		if (quote) {
			if (char === '\\') i++;
			else if (char === quote) quote = undefined;
		} else if (char === "'" || char === '"' || char === '`') {
			quote = char;
		} else if (char === '[' || char === '{' || char === '(') {
			depth++;
		} else if (char === ']' || char === '}' || char === ')') {
			if (depth === 0) break;
			depth--;
		}
	}
	// an unclosed bracket leaves `i` at the tag's end — no recoverable default
	if (text[i] !== ']') return undefined;
	const value = text
		.slice(start, i)
		.replace(/\n[ \t]*\*[ \t]?/g, '\n')
		.trim();
	return value || undefined;
};

/** A custom property name: `--` and at least one name character (CSS's, escapes aside). */
const CSS_CUSTOM_PROPERTY_NAME = /^--[\w\-\u0080-\uffff]+$/;

/**
 * Parse a `@cssprop` tag's text (after the tag name), the Custom Elements
 * Manifest form: an optional braced syntax (`{<color>}`), the name, bare
 * (`--a`) or bracketed with an optional default (`[--a=red]`), then the
 * description, its leading `- ` separator dropped. The default runs to the
 * bracket that closes the name, skipping nested brackets and quoted strings
 * (`[--a=var(--b, 1px)]`). An empty syntax or default is absent.
 *
 * @param text - the tag's comment text
 * @returns the property, or `undefined` when the text names no custom property
 *   (a name without `--`, an unclosed brace or bracket)
 */
export const parseCsspropTagText = (text: string): TsdocCssProperty | undefined => {
	let rest = text.trim();
	let syntax: string | undefined;
	if (rest.startsWith('{')) {
		const close = rest.indexOf('}');
		if (close === -1) return undefined;
		syntax = rest.slice(1, close).trim() || undefined;
		rest = rest.slice(close + 1).trimStart();
	}
	let name: string;
	let defaultValue: string | undefined;
	if (rest.startsWith('[')) {
		let depth = 0;
		let quote: string | undefined;
		let close = -1;
		for (let i = 1; i < rest.length; i++) {
			const char = rest[i]!;
			if (quote) {
				if (char === '\\') i++;
				else if (char === quote) quote = undefined;
			} else if (char === '"' || char === "'") {
				quote = char;
			} else if (char === '[' || char === '(' || char === '{') {
				depth++;
			} else if (char === ']' || char === ')' || char === '}') {
				if (depth === 0) {
					if (char === ']') close = i;
					break;
				}
				depth--;
			}
		}
		if (close === -1) return undefined;
		const inner = rest.slice(1, close);
		const equals = inner.indexOf('=');
		name = (equals === -1 ? inner : inner.slice(0, equals)).trim();
		if (equals !== -1) {
			defaultValue = inner.slice(equals + 1).trim() || undefined;
		}
		rest = rest.slice(close + 1);
	} else {
		name = /^\S*/.exec(rest)![0];
		rest = rest.slice(name.length);
	}
	if (!CSS_CUSTOM_PROPERTY_NAME.test(name)) return undefined;
	const property: TsdocCssProperty = { name };
	const description = cleanTagDescription(rest);
	if (description) property.description = description;
	if (syntax !== undefined) property.syntax = syntax;
	if (defaultValue !== undefined) property.default = defaultValue;
	return property;
};

/**
 * Parse JSDoc comment from a TypeScript node.
 *
 * Extracts and parses all JSDoc tags including:
 *
 * - `@param` - parameter descriptions
 * - `@returns` - return value description (`@return` accepted as a synonym)
 * - `@throws` - error documentation
 * - `@example` - code examples
 * - `@deprecated` - deprecation warnings
 * - `@internal` - internal-API marker (trailing prose kept)
 * - `@see` - related references
 * - `@since` - version information
 * - `@default` - default value (`@defaultValue`/`@defaultvalue` accepted as synonyms)
 * - `@mutates` - mutation documentation (non-standard)
 * - `@nodocs` - exclusion flag (non-standard)
 * - `@cssprop` - a component's CSS custom property (`@cssproperty` accepted as a synonym);
 *   a tag that documents nothing lands in `cssPropertyProblems`
 *
 * A JSDoc `@typedef` or `@callback` tag parses to the typedef's docs
 * (`parseTypedefComment`), and a `@callback`'s signature to its parameter and
 * return descriptions (`parseCallbackSignatureComment`).
 *
 * A JS function, method, or constructor with `@overload` tags is documented by
 * its overloads, as the checker types it: an `@overload`'s signature parses to
 * its block's docs plus its own `@param` and `@returns` tags
 * (`parseOverloadSignatureComment`), and the declaration to its first
 * overload's (`firstJSDocOverloadSignature`).
 * The implementation's own block is hidden, prose and tags alike, as a
 * TypeScript implementation signature's JSDoc is.
 *
 * JSDoc blocks tagged `@module` are excluded entirely (text and tags): a module
 * comment attaches to the file's first statement in the AST, and without the
 * filter it would read as that statement's own docs. Module comments parse
 * through `parseModuleComment`, which parses the comment's text the same way.
 * Typedef blocks (`isTypedefBlock`: a `@typedef`/`@callback` without a
 * `@param` or `@returns`) are excluded the same way, as TypeScript's hover
 * skips them: they document their typedefs, not the declaration below.
 * `skipTypedefBlocks: false` keeps them, for a block that stands for a module
 * or component comment, which a `@typedef` line doesn't make a typedef's:
 * there the tag drops as an unknown one, and the prose stays.
 *
 * @param node - the TypeScript node to extract JSDoc from
 * @param sourceFile - source file for full-text tag reads (`@see`); defaults to the node's own
 * @param skipTypedefBlocks - whether typedef blocks are excluded
 * @returns parsed comment with structured metadata, or undefined if no JSDoc found (or only
 *   `@module` and typedef blocks)
 *
 * @example
 * ```ts
 * const tsdoc = parseComment(declarationNode, sourceFile);
 * if (tsdoc) {
 *   console.log(tsdoc.text); // main comment text
 *   console.log(tsdoc.params); // {paramName: 'description'}
 * }
 * ```
 */
export const parseComment = (
	node: ts.Node,
	sourceFile: ts.SourceFile = node.getSourceFile(),
	skipTypedefBlocks = true
): TsdocParsedComment | undefined => {
	// `@property`/`@param` tags declare symbols themselves (JSDoc typedefs,
	// callbacks); their description rides the tag, not an attached block —
	// `getJSDocCommentsAndTags` on the tag finds nothing
	if (ts.isJSDocPropertyLikeTag(node)) {
		const text = jsdocCommentText(node.comment, sourceFile);
		const cleaned = text && cleanTagDescription(text);
		if (!cleaned) return undefined;
		const params: Record<string, string> = Object.create(null);
		return { text: cleaned, params };
	}

	if (ts.isJSDocTypedefTag(node) || ts.isJSDocCallbackTag(node)) {
		return parseTypedefComment(node, sourceFile);
	}
	if (ts.isJSDocSignature(node)) {
		if (ts.isJSDocCallbackTag(node.parent)) return parseCallbackSignatureComment(node, sourceFile);
		if (ts.isJSDocOverloadTag(node.parent)) {
			return parseOverloadSignatureComment(node, sourceFile, skipTypedefBlocks);
		}
	}
	const overload = firstJSDocOverloadSignature(node);
	if (overload) return parseOverloadSignatureComment(overload, sourceFile, skipTypedefBlocks);

	const tsdocComments = ts
		.getJSDocCommentsAndTags(node)
		.filter((c) => !belongsToModuleBlock(c) && !(skipTypedefBlocks && belongsToTypedefBlock(c)));
	if (tsdocComments.length === 0) return undefined;

	// Extract main comment text. `jsdocCommentText` keeps inline `{@link}`
	// tags — a link node carries its target in `name`, not `text`, so a manual
	// `.map((c) => c.text)` join would silently drop it.
	const texts: Array<string> = [];
	for (const comment of tsdocComments) {
		if (ts.isJSDoc(comment) && comment.comment) {
			const text = jsdocCommentText(comment.comment, sourceFile);
			if (text) texts.push(text);
		}
	}

	// Extract tags (module- and typedef-block tags filtered like their text above)
	const tags = ts
		.getJSDocTags(node)
		.filter(
			(tag) => !belongsToModuleBlock(tag) && !(skipTypedefBlocks && belongsToTypedefBlock(tag))
		);
	return parseCommentParts(texts, tags, sourceFile);
};

/**
 * Whether a JSDoc tag declares a type alias: `@typedef` or `@callback`.
 */
const isTypedefDeclaringTag = (tag: ts.JSDocTag): boolean =>
	ts.isJSDocTypedefTag(tag) || ts.isJSDocCallbackTag(tag);

/**
 * Whether a JSDoc block documents a function: it has a `@param` or
 * `@returns` tag. A `@callback`'s own `@param`/`@returns` tags sit under its
 * `JSDocSignature`, not in the block's tags, so they don't count.
 */
const isFunctionDocBlock = (block: ts.JSDoc): boolean =>
	!!block.tags?.some((t) => ts.isJSDocParameterTag(t) || ts.isJSDocReturnTag(t));

/**
 * Whether a JSDoc block is a typedef block: it declares a `@typedef` or
 * `@callback` and is not a function doc block (`isFunctionDocBlock`).
 *
 * TypeScript's reading (`getJsDocCommentsFromDeclarations` and
 * `getJsDocTagsFromDeclarations`, behind hover): a declaration other than the
 * typedef skips such a block, prose and tags alike, so it documents only the
 * typedefs it declares. A function doc block documents the function. Hover
 * also gives a typedef in it the block's prose (`getCommentHavingNodes` reads
 * the whole block for any typedef); we deliberately leave the prose to the
 * function and give the typedef only its own tag comment. `@type` is no function-doc
 * tag, so a block of prose, `@typedef {string} N`, and `@type {N}` above a
 * const gives the prose to `N`. The rule is TypeScript's in `.ts` files too, where nothing
 * binds the typedef but the declaration below still skips the block.
 */
const isTypedefBlock = (block: ts.JSDoc): boolean =>
	!!block.tags?.some(isTypedefDeclaringTag) && !isFunctionDocBlock(block);

/**
 * Whether a JSDoc node or tag belongs to a typedef block (`isTypedefBlock`),
 * which documents its typedefs and not the declaration it's attached to.
 * Per-block like `belongsToModuleBlock`; a tag outside any block (a
 * `@callback`'s nested `@param`) belongs to none.
 */
const belongsToTypedefBlock = (node: ts.JSDoc | ts.JSDocTag): boolean =>
	ts.isJSDoc(node) ? isTypedefBlock(node) : ts.isJSDoc(node.parent) && isTypedefBlock(node.parent);

/**
 * Whether a typedef or callback owns its JSDoc block's prose and block tags
 * (`@nodocs`, `@deprecated`, `@see`, `@since`, `@example`, …), not only its
 * own tag comment. It does when the block is a typedef block
 * (`isTypedefBlock`: not a function doc block), not a `@module` block, and
 * declares no other typedef or callback; a block of several leaves each one
 * its own tag comment. Both that case and a typedef in a function doc block
 * depart from hover on purpose: hover gives every typedef in a block the
 * block's prose, which here has no single owner. Hover also shows no block
 * tags on a typedef, while an owning typedef takes them here with the prose.
 * Position plays no part: a typedef block directly above a declaration
 * documents the typedef, and the declaration skips it
 * (`belongsToTypedefBlock`), as TypeScript's hover reads it.
 */
const typedefOwnsBlock = (tag: ts.JSDocTypedefTag | ts.JSDocCallbackTag): boolean => {
	const block = tag.parent;
	if (isModuleJsdocBlock(block) || !isTypedefBlock(block)) return false;
	return !block.tags?.some((t) => t !== tag && isTypedefDeclaringTag(t));
};

/**
 * Parse a JSDoc `@typedef` or `@callback`'s documentation: the block's
 * prose and tags when the typedef owns its block (`typedefOwnsBlock`), then
 * its own tag comment (`@typedef {number} A - Description 1`, the leading
 * `- ` dropped). Its `@property`, `@param`, and `@returns` tags describe its
 * members (`extractTypeAliasProperties`), not the alias.
 */
const parseTypedefComment = (
	tag: ts.JSDocTypedefTag | ts.JSDocCallbackTag,
	sourceFile: ts.SourceFile
): TsdocParsedComment | undefined => {
	const texts: Array<string> = [];
	let tags: Array<ts.JSDocTag> = [];
	const block = tag.parent;
	if (typedefOwnsBlock(tag)) {
		const blockText = jsdocCommentText(block.comment, sourceFile);
		if (blockText) texts.push(blockText);
		tags = block.tags?.filter((t) => t !== tag) ?? [];
	}
	const tagText = jsdocCommentText(tag.comment, sourceFile);
	const cleaned = tagText && cleanTagDescription(tagText);
	if (cleaned) texts.push(cleaned);
	if (texts.length === 0 && tags.length === 0) return undefined;
	return parseCommentParts(texts, tags, sourceFile);
};

/**
 * Parse a `@callback`'s signature documentation: each `@param` tag's
 * description (dotted and nested names keyed as on a function) and the
 * `@returns` text, which `emitCallOrConstructSignature` puts on the alias's
 * `(call)` member. Prose and block tags document the alias itself
 * (`parseTypedefComment`).
 */
const parseCallbackSignatureComment = (
	signature: ts.JSDocSignature,
	sourceFile: ts.SourceFile
): TsdocParsedComment | undefined => {
	const params: Record<string, string> = Object.create(null);
	// `parameters` also holds a `@this` tag, which names no parameter
	for (const param of signature.parameters) {
		if (ts.isJSDocParameterTag(param)) collectParamTag(param, params, sourceFile);
	}
	const returnText = jsdocCommentText(signature.type?.comment, sourceFile);
	const returns = returnText?.trim() || undefined;
	if (returns === undefined && Object.keys(params).length === 0) return undefined;
	return { text: '', params, returns };
};

/**
 * The signatures of a JS function, method, or constructor's `@overload` tags,
 * in order: its public signatures, which hide the implementation's. A
 * variable declaration reads its function initializer's, whose JSDoc is the
 * statement's. The checker honors `@overload` only in JS, so a `.ts` file's
 * tags declare nothing, and never on an accessor, whose tags declare nothing
 * either.
 */
export const jsdocOverloadSignatures = (node: ts.Node): Array<ts.JSDocSignature> => {
	if (!(node.flags & ts.NodeFlags.JavaScriptFile)) return [];
	const host = functionInitializer(node) ?? node;
	if (!ts.isFunctionLike(host) || ts.isJSDocSignature(host) || ts.isAccessor(host)) return [];
	return ts
		.getJSDocTags(host)
		.filter(ts.isJSDocOverloadTag)
		.map((tag) => tag.typeExpression);
};

/**
 * The docs `parseComment` hides on a JS function, method, or constructor with
 * `@overload` tags: the prose and tags of its JSDoc blocks that host no
 * `@overload` (module and typedef blocks aside), the implementation's, as a
 * TypeScript implementation signature's JSDoc is hidden. Undefined without
 * `@overload` tags, or when those blocks carry no doc content
 * (`hasDocContent`), so a types-only implementation block (`@param {T} a`)
 * counts as none.
 */
export const parseHiddenJSDocImplementationComment = (
	node: ts.Node,
	sourceFile: ts.SourceFile = node.getSourceFile()
): TsdocParsedComment | undefined => {
	if (jsdocOverloadSignatures(node).length === 0) return undefined;
	const blocks = ts
		.getJSDocCommentsAndTags(node)
		.filter(
			(c): c is ts.JSDoc =>
				ts.isJSDoc(c) &&
				!c.tags?.some(ts.isJSDocOverloadTag) &&
				!belongsToModuleBlock(c) &&
				!belongsToTypedefBlock(c)
		);
	const texts: Array<string> = [];
	for (const block of blocks) {
		const text = block.comment && jsdocCommentText(block.comment, sourceFile);
		if (text) texts.push(text);
	}
	const parsed = parseCommentParts(
		texts,
		blocks.flatMap((block) => block.tags ?? []),
		sourceFile
	);
	return hasDocContent(parsed) ? parsed : undefined;
};

/**
 * A variable's arrow-function or function-expression initializer, which
 * carries the variable's function signature (and, in JS, its statement's
 * JSDoc), or undefined for any other node.
 */
export const functionInitializer = (
	node: ts.Node
): ts.ArrowFunction | ts.FunctionExpression | undefined =>
	ts.isVariableDeclaration(node) &&
	node.initializer &&
	(ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
		? node.initializer
		: undefined;

/**
 * The first of `jsdocOverloadSignatures`, the declaration's first public
 * signature, or undefined when it has no `@overload` tags.
 */
export const firstJSDocOverloadSignature = (node: ts.Node): ts.JSDocSignature | undefined =>
	jsdocOverloadSignatures(node)[0];

/**
 * Parse an `@overload`'s documentation, TypeScript's reading of an overload
 * signature's docs (`getCommentHavingNodes`): the prose and tags of the block
 * hosting the `@overload` tag, then the signature's own `@param` and
 * `@returns` tags, which the parser nests under its `JSDocSignature`. A block
 * with several `@overload` tags gives each the block's prose and tags, its
 * other overloads' tags aside. A `@module` block contributes neither, and a
 * typedef block (`isTypedefBlock`) neither unless `skipTypedefBlocks` is
 * false, as on a declaration.
 */
const parseOverloadSignatureComment = (
	signature: ts.JSDocSignature,
	sourceFile: ts.SourceFile,
	skipTypedefBlocks: boolean
): TsdocParsedComment | undefined => {
	const texts: Array<string> = [];
	const tags: Array<ts.JSDocTag> = [];
	// typed as the enclosing `JSDoc`, but an overload tag's signature sits under the tag
	const block: ts.Node = signature.parent.parent;
	if (
		ts.isJSDoc(block) &&
		!belongsToModuleBlock(block) &&
		!(skipTypedefBlocks && isTypedefBlock(block))
	) {
		const text = jsdocCommentText(block.comment, sourceFile);
		if (text) texts.push(text);
		for (const tag of block.tags ?? []) {
			if (!ts.isJSDocOverloadTag(tag)) tags.push(tag);
		}
	}
	// `parameters` also holds a `@this` tag, which names no parameter
	for (const param of signature.parameters) {
		if (ts.isJSDocParameterTag(param)) tags.push(param);
	}
	if (signature.type) tags.push(signature.type);
	if (texts.length === 0 && tags.length === 0) return undefined;
	return parseCommentParts(texts, tags, sourceFile);
};

/**
 * Build a parsed comment from description texts (joined by newlines) and the
 * tags to read. The one tag reader every `parseComment` source shares.
 */
const parseCommentParts = (
	texts: ReadonlyArray<string>,
	tags: ReadonlyArray<ts.JSDocTag>,
	sourceFile: ts.SourceFile
): TsdocParsedComment => {
	// Null-prototype map: keys are parameter names parsed from source. Without it,
	// a parameter named after an `Object.prototype` key (`constructor`, `toString`,
	// `__proto__`, …) with no matching `@param` tag would read the inherited
	// prototype value on lookup (`tsdocParams?.[param.name]`) instead of `undefined`,
	// and writing such a key (`@param __proto__`) would pollute the prototype.
	const params: Record<string, string> = Object.create(null);
	let returns: string | undefined;
	let throws: Array<{ type?: string; description: string }> | undefined;
	let examples: Array<string> | undefined;
	let deprecatedMessage: string | undefined;
	let internalMessage: string | undefined;
	let seeAlso: Array<string> | undefined;
	let since: string | undefined;
	let defaultValue: string | undefined;
	let mutates: Record<string, string> | undefined;
	let nodocs: boolean | undefined;
	let cssProperties: Array<TsdocCssProperty> | undefined;
	let cssPropertyProblems: Array<TsdocCssPropertyProblem> | undefined;

	for (const tag of tags) {
		const tagText = jsdocCommentText(tag.comment, sourceFile);
		const tagName = tag.tagName.text;

		if (tagName === 'param' && ts.isJSDocParameterTag(tag)) {
			collectParamTag(tag, params, sourceFile);
		} else if ((tagName === 'returns' || tagName === 'return') && tagText) {
			returns = tagText.trim();
		} else if (tagName === 'throws') {
			// The standard braced form (`@throws {TypeError} - description`) parses
			// its type into the tag's typeExpression — the comment text carries only
			// the description (or nothing at all, for a bare `@throws {TypeError}`)
			const typeNode = ts.isJSDocThrowsTag(tag) ? tag.typeExpression?.type : undefined;
			if (typeNode) {
				(throws ??= []).push({
					type: typeNode.getText(sourceFile),
					description: tagText ? cleanTagDescription(tagText) : ''
				});
			} else if (tagText) {
				// Unbraced text: heuristically extract a leading word as the error type
				const match = /^\{?(\w+)\}?\s+([\s\S]+)/.exec(tagText);
				if (match) {
					(throws ??= []).push({ type: match[1], description: cleanTagDescription(match[2]!) });
				} else {
					(throws ??= []).push({ description: cleanTagDescription(tagText) });
				}
			}
		} else if (tagName === 'example' && tagText) {
			(examples ??= []).push(tagText.trim());
		} else if (tagName === 'deprecated') {
			deprecatedMessage = tagText?.trim() ?? '';
		} else if (tagName === 'internal') {
			internalMessage = tagText?.trim() ?? '';
		} else if (tagName === 'see') {
			// The TS API strips 'https' from URLs in @see tags, so get full text from source
			const fullTagText = tag.getText(sourceFile);
			// Extract content after @see, handling JSDoc formatting artifacts
			const seeContent = fullTagText
				.replace(/^@see\s+/, '') // remove @see prefix
				.replace(/\n\s*\*\s*/g, ' ') // remove JSDoc line continuations
				.replace(/\s*\*\s*$/, '') // remove trailing asterisk artifacts
				.trim();

			if (seeContent) {
				(seeAlso ??= []).push(seeContent);
			}
		} else if (tagName === 'since' && tagText) {
			since = tagText.trim();
		} else if (
			(tagName === 'default' || tagName === 'defaultValue' || tagName === 'defaultvalue') &&
			tagText
		) {
			defaultValue = tagText.trim();
		} else if (tagName === 'mutates' && tagText) {
			const parsed = parseMutatesTag(tagText);
			if (parsed) {
				// Null-prototype map: the target comes from source (it can be
				// `__proto__`, `constructor`, …); a plain object would let such a
				// key pollute the prototype on write and read back later by key.
				(mutates ??= Object.create(null))[parsed.target] = parsed.description;
			}
		} else if (tagName === 'nodocs') {
			nodocs = true;
		} else if (tagName === 'cssprop' || tagName === 'cssproperty') {
			const text = tagText?.trim() ?? '';
			const property = parseCsspropTagText(text);
			if (!property) {
				(cssPropertyProblems ??= []).push({ kind: 'malformed', text });
			} else if (cssProperties?.some(({ name }) => name === property.name)) {
				(cssPropertyProblems ??= []).push({ kind: 'duplicate', text, name: property.name });
			} else {
				(cssProperties ??= []).push(property);
			}
		}
	}

	return {
		text: texts.join('\n').trim(),
		params,
		returns,
		throws,
		examples,
		deprecatedMessage,
		internalMessage,
		seeAlso,
		since,
		defaultValue,
		mutates,
		nodocs,
		cssProperties,
		cssPropertyProblems
	};
};

/**
 * Whether a parsed comment carries any documentation — description text or an
 * extracted tag.
 *
 * Type machinery parses to an empty result (`@type`/`@typedef`/`@template`
 * tags populate no fields), so doc-hunting walks (component `docComment`) use
 * this to keep lower-precedence sources like the HTML `@component` comment
 * reachable instead of letting an annotation claim the doc slot with empty
 * text. Structural over the parsed result — any field beyond `text`/`params`
 * counts when present — so it can't drift from `parseComment`'s extraction or
 * from `TsdocParsedComment` gaining fields. `cssPropertyProblems` counts too:
 * a broken `@cssprop` is still the author's intent, and only a comment that
 * wins the doc slot gets warned about (`malformed_tag`, `duplicate_tag`).
 */
export const hasDocContent = ({ text, params, ...tags }: TsdocParsedComment): boolean =>
	text.length > 0 ||
	Object.keys(params).length > 0 ||
	Object.values(tags).some((value) => value !== undefined);

/**
 * Apply parsed TSDoc metadata to a declaration.
 *
 * Consolidates the common pattern of assigning TSDoc fields to declarations,
 * with conditional assignment for array fields (only if non-empty).
 *
 * @param declaration - declaration object to update
 * @param tsdoc - parsed TSDoc comment (if available)
 * @param isMember - whether `declaration` is a member of a container; function
 * *members* carry `defaultValue` (the documented behavior when a callback is
 * omitted) while top-level function declarations never do
 * @mutates declaration - adds docComment, deprecatedMessage, internalMessage, examples, seeAlso, throws, since, mutates, defaultValue fields
 */
export const applyToDeclaration = (
	declaration: DeclarationJsonBuild | MemberJsonBuild,
	tsdoc: TsdocParsedComment | undefined,
	isMember: boolean = false
): void => {
	if (!tsdoc) return;

	if (tsdoc.text) {
		declaration.docComment = tsdoc.text;
	}
	if (tsdoc.deprecatedMessage !== undefined) {
		declaration.deprecatedMessage = tsdoc.deprecatedMessage;
	}
	if (tsdoc.internalMessage !== undefined) {
		declaration.internalMessage = tsdoc.internalMessage;
	}

	// Only assign arrays if they have content
	if (tsdoc.examples?.length) {
		declaration.examples = tsdoc.examples;
	}
	if (tsdoc.seeAlso?.length) {
		declaration.seeAlso = tsdoc.seeAlso;
	}
	if (tsdoc.throws?.length) {
		declaration.throws = tsdoc.throws;
	}
	if (tsdoc.since) {
		declaration.since = tsdoc.since;
	}
	if (tsdoc.mutates && Object.keys(tsdoc.mutates).length > 0) {
		declaration.mutates = tsdoc.mutates;
	}
	// `defaultValue` is schema-allowed on variable declarations/members and
	// function *members* — never top-level function declarations, overloads, or
	// constructors; `v.strictObject` would reject it there. Component props
	// consume the parsed `defaultValue` directly in `svelte.ts` (not via this
	// helper).
	if (
		tsdoc.defaultValue !== undefined &&
		(declaration.kind === 'variable' || (isMember && declaration.kind === 'function'))
	) {
		declaration.defaultValue = tsdoc.defaultValue;
	}
};

/** Placeholders for the text `parseCommentText` can't hand TypeScript as written. */
interface CommentTextEscapes {
	/**
	 * Stands in for the `/` of a `*\/`, which would end the rewrapped block
	 * early.
	 */
	close: string;
	/**
	 * Stands in for an `@` that starts neither a line nor an inline `{@link}`.
	 * TypeScript starts a block tag at any `@` after whitespace, so a mid-line
	 * mention (`` `// @foo` ``, `metadata @> x`) would cut the prose or tag
	 * text short there.
	 */
	at: string;
}

/**
 * Pick two private-use code points the text doesn't hold, so restoring them
 * can't touch author text. Built from char codes, since the formatter would
 * print an escape as the invisible character.
 */
const pickCommentTextEscapes = (text: string): CommentTextEscapes => {
	const picked: Array<string> = [];
	for (let code = 0xe000; picked.length < 2; code++) {
		const char = String.fromCharCode(code);
		if (!text.includes(char)) picked.push(char);
	}
	return { close: picked[0]!, at: picked[1]! };
};

/** Escape `*\/` and every `@` but a line-leading tag's or an inline tag's. */
const escapeCommentText = (text: string, escapes: CommentTextEscapes): string =>
	text
		.replaceAll('*/', `*${escapes.close}`)
		.split('\n')
		.map((line) => {
			const tagStart = /^\s*@/.exec(line)?.[0].length ?? 0;
			return line.slice(0, tagStart) + line.slice(tagStart).replace(/(?<!\{)@/g, escapes.at);
		})
		.join('\n');

/** Restore every escape in a parsed comment's strings, keeping each object's prototype. */
const restoreCommentText = (value: unknown, escapes: CommentTextEscapes): unknown => {
	if (typeof value === 'string') {
		return value.replaceAll(`*${escapes.close}`, '*/').replaceAll(escapes.at, '@');
	}
	if (Array.isArray(value)) return value.map((entry) => restoreCommentText(entry, escapes));
	if (value !== null && typeof value === 'object') {
		const restored = Object.create(Object.getPrototypeOf(value));
		for (const [key, entry] of Object.entries(value)) {
			restored[key] = restoreCommentText(entry, escapes);
		}
		return restored;
	}
	return value;
};

/**
 * Parse comment text that has no node of its own with `parseComment`, so it
 * reads every tag exactly as a declaration's JSDoc does.
 *
 * The text is rewrapped as a JSDoc block on a throwaway statement and parsed
 * there. A `*\/` in it (an HTML comment can hold one) is escaped for the parse
 * with a placeholder the text doesn't hold, and restored in the result, and so
 * is an `@` in the middle of a line: only a line-leading `@` starts a tag
 * here, where a declaration's JSDoc, read by TypeScript in place, starts one
 * at any `@` after whitespace. A `@module`
 * line makes the block a module block, which `parseComment` skips, so
 * `parseModuleComment` strips it first.
 *
 * @param text - comment text without comment markers, as `cleanComment` returns it
 * @returns the parsed comment; its `text` is empty when the comment holds only tags
 */
export const parseCommentText = (text: string): TsdocParsedComment | undefined => {
	const escapes = pickCommentTextEscapes(text);
	const escaped = escapeCommentText(text, escapes);
	const lines = escaped.split('\n').map((line) => (line ? ` * ${line}` : ' *'));
	const source = `/**\n${lines.join('\n')}\n */\n0;\n`;
	const sourceFile = ts.createSourceFile(
		'comment.ts',
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS
	);
	const parsed = parseComment(sourceFile.statements[0]!, sourceFile, false);
	return parsed && escaped !== text
		? (restoreCommentText(parsed, escapes) as TsdocParsedComment)
		: parsed;
};

/** A line that starts with the `@module` tag, as opposed to a mention in prose. */
const MODULE_TAG_LINE = /^\s*@module\b/;

/**
 * Whether cleaned comment text is a module comment: a line starts with
 * `@module`. A backticked or mid-prose mention doesn't count.
 */
export const hasModuleTag = (text: string): boolean =>
	text.split('\n').some((line) => MODULE_TAG_LINE.test(line));

/**
 * Parse a module comment's cleaned text with `parseCommentText`, after
 * dropping each `@module` line (an optional `@module name` rename is ignored).
 *
 * Shared by every module-comment source — a TS module comment, a Svelte
 * script's, and a Svelte HTML comment with a `@module` line — so they parse
 * their tags as one. Prose after the `@module` line stays prose; prose after
 * any other tag belongs to that tag, as in a declaration's JSDoc.
 *
 * @param text - the comment's text without comment markers
 * @returns the parsed comment, or undefined when it holds neither prose nor a
 *   parsed tag (a bare `@module`)
 */
export const parseModuleComment = (text: string): TsdocParsedComment | undefined => {
	const parsed = parseCommentText(
		text
			.split('\n')
			.filter((line) => !MODULE_TAG_LINE.test(line))
			.join('\n')
	);
	return parsed && hasDocContent(parsed) ? parsed : undefined;
};

/** The `ModuleJson` fields a module comment populates. */
export type ModuleDocFields = Partial<
	Pick<
		ModuleJsonInput,
		'moduleComment' | 'examples' | 'deprecatedMessage' | 'seeAlso' | 'since' | 'internalMessage'
	>
>;

/**
 * Project a parsed module comment onto its `ModuleJson` fields: the prose as
 * `moduleComment` (absent when empty) plus the tags a module can carry. Tags
 * that only describe a declaration (`@param`, `@returns`, `@throws`,
 * `@mutates`, `@default`, `@nodocs`, `@cssprop`) are dropped; the analyzers
 * warn `misplaced_tag` for each.
 *
 * @param tsdoc - the module comment as `parseModuleComment` returns it
 */
export const toModuleDocFields = (tsdoc: TsdocParsedComment | undefined): ModuleDocFields => {
	const fields: ModuleDocFields = {};
	if (!tsdoc) return fields;
	if (tsdoc.text) fields.moduleComment = tsdoc.text;
	if (tsdoc.examples?.length) fields.examples = tsdoc.examples;
	if (tsdoc.deprecatedMessage !== undefined) fields.deprecatedMessage = tsdoc.deprecatedMessage;
	if (tsdoc.seeAlso?.length) fields.seeAlso = tsdoc.seeAlso;
	if (tsdoc.since) fields.since = tsdoc.since;
	if (tsdoc.internalMessage !== undefined) fields.internalMessage = tsdoc.internalMessage;
	return fields;
};

/**
 * Clean raw JSDoc comment text by removing comment markers and leading asterisks.
 *
 * Transforms `/** ... *\/` style comments into clean text.
 *
 * @param commentText - the raw comment text including `/**` and `*\/` markers
 * @returns cleaned comment text, or undefined if empty after cleaning
 *
 * @example
 * ```ts
 * cleanComment('/** Hello world *\/') // => 'Hello world'
 * cleanComment('/**\n * Line 1\n * Line 2\n *\/') // => 'Line 1\nLine 2'
 * ```
 */
export const cleanComment = (commentText: string): string | undefined => {
	const text = commentText
		.replace(/^\/\*\*/, '')
		.replace(/\*\/$/, '')
		.replace(/\r\n/g, '\n')
		.split('\n')
		.map((line) => line.replace(/^\s*\*\s?/, ''))
		.join('\n')
		.trim();

	return text || undefined;
};
