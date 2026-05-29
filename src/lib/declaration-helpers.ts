/**
 * Utility functions for working with declaration and member types.
 *
 * Display formatting, code generation, serialization, type narrowing,
 * and type reference discovery for `DeclarationJson` and `MemberJson`.
 *
 * @see `types.ts` for `DeclarationJson`, `MemberJson` Zod schemas
 *
 * @module
 */

import type {DeclarationJson, MemberJson, DeclarationKind, MemberKind} from './types.js';

// ── Serialization ───────────────────────────────────────────────────────────

/**
 * JSON replacer that strips Zod default values for compact serialization.
 *
 * Strips empty arrays and `false` booleans — both are Zod `.default()` values
 * restored on `.parse()`, so the round-trip is lossless for svelte-docinfo types.
 * Assumes all boolean fields in the schema default to `false` — a `true`-defaulted
 * boolean would need its `false` values preserved, breaking the round-trip.
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
export const compactReplacer = (_key: string, value: unknown): unknown =>
	(Array.isArray(value) && value.length === 0) || value === false ? undefined : value;

// ── Display Helpers ─────────────────────────────────────────────────────────

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
 * Produces `import type` for type/interface declarations, `import` for values.
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
	libraryName: string,
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

	const importKeyword =
		declaration.kind === 'type' || declaration.kind === 'interface' ? 'import type' : 'import';
	return `${importKeyword} {${declaration.name}} from '${specifier}';`;
};

const pascalCaseFromModulePath = (modulePath: string): string => {
	const moduleName = modulePath.replace(/\.(js|ts|svelte)$/, '');
	return moduleName
		.split(/[-_/]/)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join('');
};

// ── Type Reference Helpers ─────────────────────────────────────────────────

/**
 * Escape special regex characters in a string.
 */
const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Matches TypeScript identifier characters (letters, digits, `_`, `$`). */
const ID_CHAR = '[a-zA-Z0-9_$]';

/**
 * Build a regex that matches `name` only at identifier boundaries.
 *
 * Uses lookaround for `[a-zA-Z0-9_$]` instead of `\b` so that
 * `$`-prefixed identifiers like `$state` are matched correctly.
 */
const buildIdentifierPattern = (name: string): RegExp =>
	new RegExp('(?<!' + ID_CHAR + ')' + escapeRegex(name) + '(?!' + ID_CHAR + ')');

/**
 * Pre-compile identifier-boundary patterns for a set of declaration names.
 *
 * When scanning many type strings against the same declaration set,
 * call this once and pass the result to `findTypeReferences`
 * to avoid recompiling regexes on every call.
 *
 * @param declarationNames - set of known in-project declaration names
 * @returns array of `[name, pattern]` pairs for use with `findTypeReferences`
 *
 * @example
 * ```ts
 * const names = new Set(modules.flatMap(m => m.declarations.map(d => d.name)));
 * const patterns = buildTypeReferencePatterns(names);
 * for (const decl of declarations) {
 *   const refs = findTypeReferences(decl.typeSignature, patterns);
 * }
 * ```
 */
export const buildTypeReferencePatterns = (
	declarationNames: ReadonlySet<string>,
): Array<[string, RegExp]> => {
	const patterns: Array<[string, RegExp]> = [];
	for (const name of declarationNames) {
		if (name) patterns.push([name, buildIdentifierPattern(name)]);
	}
	return patterns;
};

/**
 * Find in-project declaration names referenced in a type string.
 *
 * Uses identifier-boundary matching to find which known declaration names appear
 * in an opaque type string (e.g., `typeSignature`, `returnType`, parameter `type`).
 * Enables consumers to render clickable type links without needing access to
 * the TypeScript type checker.
 *
 * Handles identifiers starting with `$` (e.g., `$state`) which `\b` does not
 * recognize as word boundaries.
 *
 * Accepts either a `ReadonlySet<string>` (convenience) or pre-compiled patterns
 * from `buildTypeReferencePatterns` (performance). Use pre-compiled patterns
 * when scanning many type strings against the same declaration set.
 *
 * **Known limitations**: Identifier-boundary matching can produce false positives
 * when a declaration name appears as a property key in an object literal type
 * (e.g., `{ Foo: string }` when `Foo` is a declaration). This is rare in practice.
 *
 * @param typeString - opaque type string from analysis output
 * @param declarationNames - set of names or pre-compiled patterns from `buildTypeReferencePatterns`
 * @returns array of declaration names found in the type string
 *
 * @example
 * ```ts
 * const names = new Set(modules.flatMap(m => m.declarations.map(d => d.name)));
 * findTypeReferences('Map<string, ModuleJson[]>', names)
 * // => ['ModuleJson']
 * ```
 */
export const findTypeReferences = (
	typeString: string,
	declarationNames: ReadonlySet<string> | Array<[string, RegExp]>,
): Array<string> => {
	if (!typeString) return [];
	const patterns: Array<[string, RegExp]> = Array.isArray(declarationNames)
		? declarationNames
		: buildTypeReferencePatterns(declarationNames);
	const refs: Array<string> = [];
	for (const [name, pattern] of patterns) {
		if (pattern.test(typeString)) {
			refs.push(name);
		}
	}
	return refs;
};

// ── Narrowed Declaration Types ──────────────────────────────────────────────

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
	kind: K,
): declaration is Extract<DeclarationJson | MemberJson, {kind: K}> => declaration.kind === kind;
