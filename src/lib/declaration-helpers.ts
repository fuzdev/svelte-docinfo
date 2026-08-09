/**
 * Utility functions for working with declaration and member types.
 *
 * Display formatting, code generation, serialization, type narrowing,
 * and `TypeJson` tokenization for `DeclarationJson` and `MemberJson`.
 *
 * @see `types.ts` for `DeclarationJson`, `MemberJson`, `TypeJson` Zod schemas
 *
 * @module
 */

import type {
	DeclarationJson,
	MemberJson,
	DeclarationKind,
	MemberKind,
	TupleElementJson,
	TypeJson
} from './types.ts';

// Serialization

/**
 * JSON replacer that strips Zod default values for compact serialization.
 *
 * Strips empty arrays and `false` booleans — both are Zod `.default()` values
 * restored on `.parse()`, so the round-trip is lossless for svelte-docinfo types.
 * Assumes all boolean fields in the schema default to `false` — a `true`-defaulted
 * boolean would need its `false` values preserved, breaking the round-trip.
 *
 * One keyed exemption: `value` is never stripped. `TypeJson`'s literal nodes
 * carry data there (`{kind: 'literal', value: false}` is the literal type
 * `false`, required by the schema), not a defaulted flag — no other output
 * field is named `value`, and any future one must not be a `false`-defaulted
 * boolean.
 *
 * **Root-value caveat**: `JSON.stringify([], compactReplacer)` returns the JS
 * `undefined` (not the string `'[]'`), and `JSON.stringify(false, compactReplacer)`
 * returns the JS `undefined` too. Object-rooted callers (`AnalyzeResultJson`
 * envelope, CLI output) don't hit this — empty inner arrays strip and
 * `AnalyzeResultJson.parse` restores them on the consumer side. Array-rooted
 * callers (Vite plugin, anyone splicing the JSON into a source template)
 * must handle the empty case themselves before calling this; see
 * `vite.ts:updateOutputFromQuery` for the pattern.
 *
 * Two guard tests in `declaration-helpers.test.ts` lock this in:
 * - `every z.boolean().default in types.ts uses false` — source-regex check
 *   that fails on a new `z.boolean().default(true)`.
 * - `parse → stringify(compactReplacer) → parse is a faithful round-trip
 *   across every variant` — exercises every variant and member through a
 *   full round-trip, catching regressions where a `.default(false)` or
 *   `.default([])` is removed (or a new field is added that the replacer
 *   drops but Zod doesn't restore).
 *
 * @example
 * ```ts
 * const result = await analyze({sourceFiles, sourceOptions});
 * const json = JSON.stringify(result, compactReplacer);
 * // On the consumer side, restore Zod defaults:
 * const restored = AnalyzeResultJson.parse(JSON.parse(json));
 * ```
 */
export const compactReplacer = (key: string, value: unknown): unknown =>
	(Array.isArray(value) && value.length === 0) || (value === false && key !== 'value')
		? undefined
		: value;

// Display Helpers

/**
 * Format declaration or member name with generic parameters for display.
 *
 * Default-slot entries return the literal `'default'` (the symbol's actual
 * name in JS). Renderers that want a richer label (PascalCased module path,
 * an explicit "default export" header) should branch on `name === 'default'`
 * themselves before calling this.
 *
 * @see `generateImport` for the divergent default-slot fallback used in
 *   import-statement generation (PascalCased module path, since an import
 *   needs a JS identifier binding, not a label).
 *
 * @param declaration - the `DeclarationJson` or `MemberJson` to format
 * @returns name with generic parameters appended (e.g., `Map<K, V>`)
 *
 * @example
 * ```ts
 * getDisplayName({name: 'Map', kind: 'type', genericParams: [{name: 'K'}, {name: 'V'}]})
 * // => 'Map<K, V>'
 * ```
 */
export const getDisplayName = (declaration: DeclarationJson | MemberJson): string => {
	if (!declaration.genericParams.length) return declaration.name;
	const params = declaration.genericParams.map((p) => {
		let param = p.name;
		if (p.constraint) param += ` extends ${p.constraint}`;
		if (p.defaultType) param += ` = ${p.defaultType}`;
		return param;
	});
	return `${declaration.name}<${params.join(', ')}>`;
};

/**
 * Generate TypeScript import statement for a declaration.
 *
 * Produces `import type` for type/interface declarations, `import` for values —
 * including type/interface declarations marked `mergedValue` (a merged
 * value+type symbol like a schema/type pair is importable as a runtime value,
 * so a type-only import would break value use).
 *
 * **Default export handling**: when `declaration.name === 'default'`, emits
 * `import X from '...'` with the binding derived by PascalCasing the module
 * path. (`'default'` is the symbol's actual name in JS — `import X from 'mod'`
 * is sugar for `import {default as X} from 'mod'`.)
 *
 * @see `getDisplayName` for the divergent default-slot fallback used as a
 *   display label (the literal `'default'`, since a label has no use for a
 *   synthesized JS binding).
 *
 * @param declaration - the `DeclarationJson` to generate an import for
 * @param modulePath - module path relative to source root (e.g., `foo.ts`)
 * @param libraryName - package name for the import specifier (e.g., `@pkg/lib`)
 * @returns formatted import statement string
 *
 * @example
 * ```ts
 * generateImport({name: 'Foo', kind: 'type'}, 'foo.ts', '@pkg/lib')
 * // => "import type {Foo} from '@pkg/lib/foo.js';"
 *
 * generateImport({name: 'default', kind: 'function'}, 'foo-bar.ts', '@pkg/lib')
 * // => "import FooBar from '@pkg/lib/foo-bar.js';"
 * ```
 */
export const generateImport = (
	declaration: DeclarationJson,
	modulePath: string,
	libraryName: string
): string => {
	const jsPath = modulePath.replace(/\.ts$/, '.js');
	const specifier = `${libraryName}/${jsPath}`;

	// Default-slot entries — derive the import binding from the module path.
	if (declaration.name === 'default') {
		return `import ${pascalCaseFromModulePath(modulePath)} from '${specifier}';`;
	}

	// Components are default exports in Svelte
	if (declaration.kind === 'component') {
		return `import ${declaration.name} from '${specifier}';`;
	}

	// Namespace re-export: `export * as ns from './x'` in the source becomes
	// `import * as ns from '<package>/<re-exporter>.js'` for consumers.
	if (declaration.kind === 'namespace') {
		return `import * as ${declaration.name} from '${specifier}';`;
	}

	// A merged value+type symbol is importable as a runtime value — `import
	// type` would break value use (`Foo.parse(...)` on a schema/type pair).
	// Absent `mergedValue` (wire-form input with the default stripped) means
	// not merged, so the type-only rendering is safe.
	const typeOnly =
		(declaration.kind === 'type' || declaration.kind === 'interface') && !declaration.mergedValue;
	return `${typeOnly ? 'import type' : 'import'} {${declaration.name}} from '${specifier}';`;
};

const pascalCaseFromModulePath = (modulePath: string): string => {
	const moduleName = modulePath.replace(/\.(js|ts|svelte)$/, '');
	return moduleName
		.split(/[-_/]/)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join('');
};

// TypeJson Tokenization

/**
 * One rendered piece of a `TypeJson` tree, produced by `typeJsonToTokens`:
 * `name` tokens are candidate references for a renderer to link (or print
 * plainly) — reference names, alias names of alias-carrying
 * unions/intersections — `code` tokens are terminal type text (intrinsics,
 * literals, anonymous objects/functions, depth-capped nodes) for a renderer
 * to syntax-highlight, and `text` tokens are structural punctuation
 * (`<`, ` | `, `[]`, tuple labels).
 */
export type TypeJsonToken =
	{ kind: 'text'; text: string } | { kind: 'name'; name: string } | { kind: 'code'; text: string };

/**
 * Whether a node's rendering is ambiguous when composed into a surrounding
 * union, intersection, or array and needs parentheses. Alias-carrying
 * unions/intersections render as their bare alias name, so they compose
 * without parens.
 */
const needsParens = (node: TypeJson): boolean =>
	node.kind === 'function' ||
	((node.kind === 'union' || node.kind === 'intersection') && node.alias === undefined);

const pushText = (tokens: Array<TypeJsonToken>, text: string): void => {
	const last = tokens.at(-1);
	if (last?.kind === 'text') {
		last.text += text;
	} else {
		tokens.push({ kind: 'text', text });
	}
};

const pushParenthesized = (tokens: Array<TypeJsonToken>, node: TypeJson): void => {
	if (needsParens(node)) {
		pushText(tokens, '(');
		pushNode(tokens, node);
		pushText(tokens, ')');
	} else {
		pushNode(tokens, node);
	}
};

// a rest element's type is already the array it collects, so `...` composes
// directly; an unnamed optional element takes the postfix form (`[string?]`)
const pushTupleElement = (tokens: Array<TypeJsonToken>, element: TupleElementJson): void => {
	if (element.rest) pushText(tokens, '...');
	if (element.name === undefined) {
		pushNode(tokens, element.type);
		if (element.optional) pushText(tokens, '?');
	} else {
		pushText(tokens, element.optional ? `${element.name}?: ` : `${element.name}: `);
		pushNode(tokens, element.type);
	}
};

const pushNode = (tokens: Array<TypeJsonToken>, node: TypeJson): void => {
	switch (node.kind) {
		case 'reference': {
			tokens.push({ kind: 'name', name: node.name });
			const { typeArgs } = node;
			if (typeArgs?.length) {
				pushText(tokens, '<');
				for (let i = 0; i < typeArgs.length; i++) {
					if (i > 0) pushText(tokens, ', ');
					pushNode(tokens, typeArgs[i]!);
				}
				pushText(tokens, '>');
			}
			break;
		}
		case 'union':
		case 'intersection': {
			// a written sub-alias survives as an alias-carrying node — emit the
			// name (linkable) rather than expanding the members it stands for
			if (node.alias !== undefined) {
				tokens.push({ kind: 'name', name: node.alias });
				break;
			}
			const separator = node.kind === 'union' ? ' | ' : ' & ';
			for (let i = 0; i < node.members.length; i++) {
				if (i > 0) pushText(tokens, separator);
				pushParenthesized(tokens, node.members[i]!);
			}
			break;
		}
		case 'array': {
			if (node.readonly) pushText(tokens, 'readonly ');
			pushParenthesized(tokens, node.element);
			pushText(tokens, '[]');
			break;
		}
		case 'tuple': {
			if (node.readonly) pushText(tokens, 'readonly ');
			pushText(tokens, '[');
			const { elements } = node;
			if (elements) {
				for (let i = 0; i < elements.length; i++) {
					if (i > 0) pushText(tokens, ', ');
					pushTupleElement(tokens, elements[i]!);
				}
			}
			pushText(tokens, ']');
			break;
		}
		default: {
			// terminal kinds: intrinsic, literal, function, object, other
			tokens.push({ kind: 'code', text: node.text });
		}
	}
};

/**
 * Flatten a `TypeJson` tree into a render-ready token list.
 *
 * The semantic linearization for renderers: spacing, separators,
 * parenthesization (`((x) => void) | null`, `(A | B)[]`), and tuple labels
 * (`[a: string, b?: number, ...rest: boolean[]]`) are decided here — in
 * lockstep with the `TypeJson` schema's projection rules — so a renderer
 * maps tokens to output without re-deriving type syntax. What a token
 * *looks like* stays the consumer's decision: fuz_ui links `name` tokens to
 * API docs and syntax-highlights `code` tokens; a CLI might print them all
 * plainly. Adjacent punctuation merges into single `text` tokens.
 *
 * @param node - the `TypeJson` tree to flatten (a `typeInfo`/`returnTypeInfo` field)
 * @returns tokens in source order; concatenating their text yields the printed type
 *
 * @example
 * ```ts
 * typeJsonToTokens({kind: 'reference', name: 'Map', typeArgs: [
 * 	{kind: 'intrinsic', text: 'string'},
 * 	{kind: 'reference', name: 'Tome'}
 * ]})
 * // => [{kind: 'name', name: 'Map'}, {kind: 'text', text: '<'},
 * //     {kind: 'code', text: 'string'}, {kind: 'text', text: ', '},
 * //     {kind: 'name', name: 'Tome'}, {kind: 'text', text: '>'}]
 * ```
 */
export const typeJsonToTokens = (node: TypeJson): Array<TypeJsonToken> => {
	const tokens: Array<TypeJsonToken> = [];
	pushNode(tokens, node);
	return tokens;
};

// Narrowed Declaration Types

/**
 * Narrow a declaration by kind for type-safe field access.
 *
 * Works with both `DeclarationJson` (top-level) and `MemberJson` (nested).
 * Accepts `DeclarationKind | MemberKind` so `isKind(member, 'constructor')` compiles.
 *
 * @example
 * ```ts
 * if (isKind(declaration, 'function')) {
 *   declaration.parameters; // FunctionDeclarationJson — has parameters
 *   declaration.returnType; // has returnType
 * }
 * if (isKind(member, 'constructor')) {
 *   member.parameters; // ConstructorMemberJson — has parameters
 * }
 * ```
 */
export const isKind = <K extends DeclarationKind | MemberKind>(
	declaration: DeclarationJson | MemberJson,
	kind: K
): declaration is Extract<DeclarationJson | MemberJson, { kind: K }> => declaration.kind === kind;
