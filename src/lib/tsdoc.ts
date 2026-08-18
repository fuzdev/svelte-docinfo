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
 * bare tag) while the declaration stays documented. Use `@nodocs` to exclude
 * a declaration from output entirely.
 *
 * The `@nodocs` tag excludes exports from documentation and flat namespace validation.
 * The declaration is still exported and usable, just not documented.
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
 * JSDoc blocks tagged `@module` are excluded from `parseComment` entirely (text
 * and tags) — module comments attach to the file's first statement in the AST
 * and are owned by `extractModuleComment` instead.
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
 * Whether a JSDoc block is a module-level comment (carries a `@module` tag).
 */
const isModuleJsdocBlock = (jsdoc: ts.JSDoc): boolean =>
	jsdoc.tags?.some((tag) => tag.tagName.text === 'module') ?? false;

/**
 * Whether a JSDoc node or tag belongs to a module-level (`@module`) block.
 *
 * A module comment physically precedes the file's first statement, so the AST
 * attaches it to that statement's JSDoc — without this filter the module
 * comment (including tags like `@nodocs`) would read as the statement's own
 * docs. Per-block, so a statement's own JSDoc below a module comment still
 * applies. `extractModuleComment` owns module-comment extraction.
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
 * filter it would read as that statement's own docs. `extractModuleComment`
 * (`typescript-exports.ts`) owns module comments.
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
		const text = ts.getTextOfJSDocComment(node.comment);
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

	// Extract main comment text. `getTextOfJSDocComment` keeps inline `{@link}`
	// tags — a link node carries its target in `name`, not `text`, so a manual
	// `.map((c) => c.text)` join would silently drop it.
	for (const comment of tsdocComments) {
		if (ts.isJSDoc(comment) && comment.comment) {
			const text = ts.getTextOfJSDocComment(comment.comment);
			if (text) {
				fullText += text + '\n';
			}
		}
	}

	// Extract tags (module-block tags filtered like their text above)
	const tags = ts.getJSDocTags(node).filter((tag) => !belongsToModuleBlock(tag));
	for (const tag of tags) {
		const tagText = ts.getTextOfJSDocComment(tag.comment);
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
	// constructors; `z.strictObject` would reject it there. Component props
	// consume the parsed `defaultValue` directly in `svelte.ts` (not via this
	// helper).
	if (
		tsdoc.defaultValue !== undefined &&
		(declaration.kind === 'variable' || (isMember && declaration.kind === 'function'))
	) {
		declaration.defaultValue = tsdoc.defaultValue;
	}
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
