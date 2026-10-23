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
 *
 * JSDoc blocks tagged `@module` are excluded entirely (text and tags): a module
 * comment attaches to the file's first statement in the AST, and without the
 * filter it would read as that statement's own docs. Module comments parse
 * through `parseModuleComment`, which hands this function the comment's text.
 *
 * @param node - the TypeScript node to extract JSDoc from
 * @param sourceFile - source file for full-text tag reads (`@see`); defaults to the node's own
 * @returns parsed comment with structured metadata, or undefined if no JSDoc found (or only `@module` blocks)
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
	sourceFile: ts.SourceFile = node.getSourceFile()
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

	const tsdocComments = ts.getJSDocCommentsAndTags(node).filter((c) => !belongsToModuleBlock(c));
	if (tsdocComments.length === 0) return undefined;

	let fullText = '';
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

	// Extract main comment text. `jsdocCommentText` keeps inline `{@link}`
	// tags — a link node carries its target in `name`, not `text`, so a manual
	// `.map((c) => c.text)` join would silently drop it.
	for (const comment of tsdocComments) {
		if (ts.isJSDoc(comment) && comment.comment) {
			const text = jsdocCommentText(comment.comment, sourceFile);
			if (text) {
				fullText += text + '\n';
			}
		}
	}

	// Extract tags (module-block tags filtered like their text above)
	const tags = ts.getJSDocTags(node).filter((tag) => !belongsToModuleBlock(tag));
	for (const tag of tags) {
		const tagText = jsdocCommentText(tag.comment, sourceFile);
		const tagName = tag.tagName.text;

		if (tagName === 'param' && ts.isJSDocParameterTag(tag)) {
			// Extract parameter name and description
			const paramName = ts.isIdentifier(tag.name) ? tag.name.text : tag.name.getText();
			if (paramName && tagText) {
				params[paramName] = cleanTagDescription(tagText);
			}
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
		}
	}

	fullText = fullText.trim();

	return {
		text: fullText,
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
		nodocs
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
 * from `TsdocParsedComment` gaining fields.
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
	const parsed = parseComment(sourceFile.statements[0]!, sourceFile);
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
 * `@mutates`, `@default`, `@nodocs`) are dropped; the analyzers warn
 * `misplaced_tag` for each.
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
