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
 * Supports a subset of standard TSDoc tags:
 * `@param`, `@returns`, `@throws`, `@example`, `@deprecated`, `@see`, `@since`, `@default`, `@nodocs`.
 *
 * The `@nodocs` tag excludes exports from documentation and flat namespace validation.
 * The declaration is still exported and usable, just not documented.
 *
 * Also supports `@mutates` (non-standard) for documenting mutations to parameters or external state.
 * Uses same format as `@param`: `@mutates key - description of mutation`. The key is
 * unvalidated — typically a parameter name, but compound paths (`this.foo`, `obj.field`)
 * and external state references are accepted as-is.
 *
 * Only `@returns` is supported (not `@return`).
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
 * Due to TS Compiler API limitations:
 * - TS API includes dash separator in `@param` tag text; we strip the leading `- ` as it's syntax, not content
 * - `@throws` tags have `{Type}` stripped by TS API; fallback regex extracts first word as error type
 * - TS API strips URL protocols from `@see` tag text; we use `getText()` to preserve original format including `{@link}` syntax
 *
 * @see `declaration-build.ts` for `DeclarationJsonBuild`
 * @see `typescript-exports.ts` and `svelte.ts` as primary consumers
 *
 * @module
 */

import ts from 'typescript';

import type {DeclarationJsonBuild, MemberJsonBuild} from './declaration-build.js';

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
	/** Return value description from `@returns`. */
	returns?: string;
	/** Thrown errors from `@throws`. */
	throws?: Array<{type?: string; description: string}>;
	/** Code examples from `@example`. */
	examples?: Array<string>;
	/** Deprecation message from `@deprecated`. */
	deprecatedMessage?: string;
	/** Related references from `@see`. */
	seeAlso?: Array<string>;
	/** Version information from `@since`. */
	since?: string;
	/** Default value from `@default` tag. */
	defaultValue?: string;
	/** Mutation documentation from `@mutates` (non-standard), mapped by parameter name. */
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
 * - `@returns` - return value description
 * - `@throws` - error documentation
 * - `@example` - code examples
 * - `@deprecated` - deprecation warnings
 * - `@see` - related references
 * - `@since` - version information
 * - `@default` - default value
 * - `@mutates` - mutation documentation (non-standard)
 * - `@nodocs` - exclusion flag (non-standard)
 *
 * JSDoc blocks tagged `@module` are excluded entirely (text and tags): a module
 * comment attaches to the file's first statement in the AST, and without the
 * filter it would read as that statement's own docs. `extractModuleComment`
 * (`typescript-exports.ts`) owns module comments.
 *
 * @param node - the TypeScript node to extract JSDoc from
 * @param sourceFile - source file (used for extracting full `@see` tag text)
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
	sourceFile: ts.SourceFile,
): TsdocParsedComment | undefined => {
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
	let throws: Array<{type?: string; description: string}> | undefined;
	let examples: Array<string> | undefined;
	let deprecatedMessage: string | undefined;
	let seeAlso: Array<string> | undefined;
	let since: string | undefined;
	let defaultValue: string | undefined;
	let mutates: Record<string, string> | undefined;
	let nodocs: boolean | undefined;

	// Extract main comment text
	for (const comment of tsdocComments) {
		if (ts.isJSDoc(comment) && comment.comment) {
			const text =
				typeof comment.comment === 'string'
					? comment.comment
					: comment.comment.map((c) => c.text).join('');
			fullText += text + '\n';
		}
	}

	// Extract tags (module-block tags filtered like their text above)
	const tags = ts.getJSDocTags(node).filter((tag) => !belongsToModuleBlock(tag));
	for (const tag of tags) {
		const tagText =
			typeof tag.comment === 'string' ? tag.comment : tag.comment?.map((c) => c.text).join('');
		const tagName = tag.tagName.text;

		if (tagName === 'param' && ts.isJSDocParameterTag(tag)) {
			// Extract parameter name and description
			const paramName = ts.isIdentifier(tag.name) ? tag.name.text : tag.name.getText();
			if (paramName && tagText) {
				params[paramName] = cleanTagDescription(tagText);
			}
		} else if (tagName === 'returns' && tagText) {
			returns = tagText.trim();
		} else if (tagName === 'throws' && tagText) {
			// Try to extract error type and description
			const match = /^\{?(\w+)\}?\s+(.+)/.exec(tagText);
			if (match) {
				(throws ??= []).push({type: match[1], description: cleanTagDescription(match[2]!)});
			} else {
				(throws ??= []).push({description: cleanTagDescription(tagText)});
			}
		} else if (tagName === 'example' && tagText) {
			(examples ??= []).push(tagText.trim());
		} else if (tagName === 'deprecated') {
			deprecatedMessage = tagText?.trim() ?? '';
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
		} else if (tagName === 'default' && tagText) {
			defaultValue = tagText.trim();
		} else if (tagName === 'mutates' && tagText) {
			// Extract parameter name and description (format: @mutates paramName - description)
			const cleanedText = cleanTagDescription(tagText);
			const match = /^(\w+)\s+-?\s*(.+)/.exec(cleanedText);
			if (match) {
				const paramName = match[1]!;
				const description = match[2]!.trim();
				// Null-prototype map: `paramName` comes from source (`\w+` matches
				// `__proto__`, `constructor`, …); a plain object would let such a key
				// pollute the prototype on write and read back later by key.
				(mutates ??= Object.create(null))[paramName] = description;
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
		seeAlso,
		since,
		defaultValue,
		mutates,
		nodocs,
	};
};

/**
 * Apply parsed TSDoc metadata to a declaration.
 *
 * Consolidates the common pattern of assigning TSDoc fields to declarations,
 * with conditional assignment for array fields (only if non-empty).
 *
 * @param declaration - declaration object to update
 * @param tsdoc - parsed TSDoc comment (if available)
 * @mutates declaration - adds docComment, deprecatedMessage, examples, seeAlso, throws, since, mutates, defaultValue fields
 */
export const applyToDeclaration = (
	declaration: DeclarationJsonBuild | MemberJsonBuild,
	tsdoc: TsdocParsedComment | undefined,
): void => {
	if (!tsdoc) return;

	if (tsdoc.text) {
		declaration.docComment = tsdoc.text;
	}
	if (tsdoc.deprecatedMessage !== undefined) {
		declaration.deprecatedMessage = tsdoc.deprecatedMessage;
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
	// `defaultValue` is schema-allowed on variable declarations/members only;
	// `z.strictObject` would reject it on other kinds. Component props consume
	// the parsed `defaultValue` directly in `svelte.ts` (not via this helper).
	if (tsdoc.defaultValue !== undefined && declaration.kind === 'variable') {
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
