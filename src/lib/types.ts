/**
 * Metadata types for library source code analysis.
 *
 * These types represent the structure of `src/lib/` exports,
 * extracted at build time via TypeScript compiler analysis.
 * Used for generating API documentation and enabling code search.
 *
 * Hierarchy: `ModuleJson` → `DeclarationJson` (discriminated union on `kind`) → `MemberJson` (discriminated union on `kind`)
 *
 * ## Zod input/output split
 *
 * Array fields use `.default([])` so they're optional in serialized JSON (compact)
 * but guaranteed `[]` at runtime after `.parse()`. Input types (`ModuleJsonInput`,
 * `DeclarationJsonInput`, `ComponentPropJsonInput`) accept optional arrays;
 * output types (`ModuleJson`, `DeclarationJson`, `ComponentPropJson`) guarantee arrays.
 * Use `compactReplacer` (in `declaration-helpers.ts`) with `JSON.stringify` for compact output.
 *
 * ## Discriminated union
 *
 * `DeclarationJson` is a `z.discriminatedUnion` on `kind` with 9 variants:
 * `FunctionDeclarationJson`, `ClassDeclarationJson`, `InterfaceDeclarationJson`,
 * `TypeDeclarationJson`, `VariableDeclarationJson`, `EnumDeclarationJson`,
 * `ComponentDeclarationJson`, `SnippetDeclarationJson`, `NamespaceDeclarationJson`.
 * Each variant has only the fields relevant to that kind, enforced by
 * `z.strictObject`. Use `isKind` (in `declaration-helpers.ts`) to narrow.
 *
 * `MemberJson` is similarly a `z.discriminatedUnion` on `kind` with 3 variants:
 * `FunctionMemberJson`, `VariableMemberJson`, `ConstructorMemberJson`.
 * Each variant has only the fields relevant to that member kind.
 *
 * Internal analysis code that constructs declarations incrementally uses
 * `DeclarationJsonBuild` — a permissive interface with all fields optional.
 * Zod validation at the `ModuleJson.parse()` boundary enforces variant correctness.
 *
 * @see `declaration-helpers.ts` for display formatting and type narrowing utilities
 * @see `analyze.ts` for the main analysis entry points
 * @see `tsdoc.ts` for JSDoc/TSDoc extraction into these types
 * @see `postprocess.ts` for post-processing (`mergeReExports`, `findDuplicates`)
 *
 * @module
 */

import {z} from 'zod';

/**
 * The kind of top-level exported declaration.
 *
 * Does not include `'constructor'` — constructors only appear as `MemberKind`
 * (nested in classes, interfaces, or types with construct signatures), never as
 * top-level module exports.
 */
export const DeclarationKind = z.enum([
	'type',
	'function',
	'variable',
	'class',
	'interface',
	'enum',
	'component',
	'snippet',
	'namespace',
]);
export type DeclarationKind = z.infer<typeof DeclarationKind>;

/**
 * TypeScript modifier keywords extracted from declarations.
 *
 * Only modifiers that appear on public API members are included.
 * Private members (including `#field` syntax) are filtered out during analysis.
 * Protected members are included as part of the extension API.
 */
export const DeclarationModifier = z.enum([
	'public',
	'protected',
	'readonly',
	'static',
	'abstract',
	'getter',
	'setter',
]);
export type DeclarationModifier = z.infer<typeof DeclarationModifier>;

/**
 * Reactivity flavor for a variable declaration or class field, captured from
 * the rune call at the initializer (e.g., `let count = $state(0)`).
 *
 * Only the value-producing reactivity runes are represented here — `$props`
 * and `$bindable` are modeled separately as `ComponentPropJson.bindable`
 * (and prop-presence on the `props` array). A renderer wanting "all rune
 * annotations across declarations and props" needs to read both this field
 * and `ComponentPropJson.bindable`.
 *
 * - `$state` — deeply reactive proxy
 * - `$state.raw` — reference-only reactive (no proxy)
 * - `$derived` — recomputed from dependencies (re-assignable)
 * - `$derived.by` — same as `$derived`, with a function argument
 *
 * Detection is syntactic (AST-based) and runs on every analyzed file
 * regardless of extension. Most reactive declarations live in `.svelte`,
 * `.svelte.ts`, or `.svelte.js`, but the field will also surface on any
 * `.ts`/`.js` file that uses the same rune call patterns — by design, so
 * documentation pipelines can capture any rune-shaped declaration their
 * conventions choose to expose.
 */
export const Reactivity = z.enum(['$state', '$state.raw', '$derived', '$derived.by']);
export type Reactivity = z.infer<typeof Reactivity>;

/**
 * Generic type parameter metadata extracted from declarations like `<T extends string = unknown>`.
 *
 * Present on functions, classes, interfaces, type aliases, and Svelte components
 * that declare generic type parameters.
 */
export const GenericParamJson = z.strictObject({
	/** Parameter name like `T`. */
	name: z.string(),
	/** Constraint like `string` from `T extends string`. */
	constraint: z.string().optional(),
	/** Default type like `unknown` from `T = unknown`. */
	defaultType: z.string().optional(),
});
export type GenericParamJson = z.infer<typeof GenericParamJson>;

/**
 * Parameter information for functions and methods.
 *
 * Kept distinct from `ComponentPropJson` despite structural similarity.
 * Function parameters form a tuple with positional semantics:
 * calling order matters (`fn(a, b)` vs `fn(b, a)`),
 * may include rest parameters and destructuring patterns.
 */
export const ParameterJson = z.strictObject({
	/** Parameter name (e.g., `options`, `...args`). */
	name: z.string(),
	/** Resolved TypeScript type string (e.g., `string`, `Record<string, unknown>`). */
	type: z.string(),
	/** Whether the parameter has a `?` token. */
	optional: z.boolean().default(false),
	/** Whether the parameter uses rest syntax (`...args`). */
	rest: z.boolean().default(false),
	/** Description from `@param` tag. */
	description: z.string().optional(),
	/** Default value expression from the source (e.g., `'hello'`, `42`). */
	defaultValue: z.string().optional(),
	/**
	 * Descriptions for properties of a named object parameter, from dotted
	 * `@param` tags (`@param obj.prop - ...`).
	 *
	 * Keyed by the sub-path relative to this parameter — `@param obj.prop`
	 * becomes `{prop: '...'}`, `@param obj.a.b` becomes `{'a.b': '...'}`.
	 * Keys are unvalidated against the parameter's actual type (matching the
	 * `@mutates` philosophy); absent when no dotted `@param` tags reference
	 * this parameter. Only populated for function/method/constructor
	 * signature parameters.
	 *
	 * Matching is by the parameter's name, so destructured parameters
	 * (`fn({a, b}: T)`) are not covered — TypeScript names them `__0`, with no
	 * author-facing identifier for a `@param` key to reference.
	 */
	propertyDescriptions: z.record(z.string(), z.string()).optional(),
});
export type ParameterJson = z.infer<typeof ParameterJson>;
export type ParameterJsonInput = z.input<typeof ParameterJson>;

/**
 * Doc-comment fields shared across declarations, members, and component props.
 *
 * Extracted so `declarationSharedFields` and `ComponentPropJson` reference
 * the same field definitions without duplication.
 */
const docFields = {
	/** Code examples from `@example` tags. */
	examples: z.array(z.string()).default([]),
	/** Deprecation message from `@deprecated` tag. */
	deprecatedMessage: z.string().optional(),
	/** Related items from `@see` tags, in raw TSDoc format. */
	seeAlso: z.array(z.string()).default([]),
	/** Exceptions from `@throws` tags. */
	throws: z
		.array(z.strictObject({type: z.string().optional(), description: z.string()}))
		.default([]),
	/** Version introduced, from `@since` tag. */
	since: z.string().optional(),
} as const;

/**
 * Component prop information for Svelte components.
 *
 * Standalone schema (not extending `ParameterJson`) because component props
 * have different semantics: named attributes with no positional order
 * (`<Foo {a} {b} />` = `<Foo {b} {a} />`), no rest parameters,
 * and support for two-way binding via `$bindable` rune.
 */
export const ComponentPropJson = z.strictObject({
	/** Prop name as declared in the component's `$props()` type. */
	name: z.string(),
	/** Resolved TypeScript type string. */
	type: z.string(),
	/** Whether the prop is optional in the component's props type. */
	optional: z.boolean().default(false),
	/** Description from JSDoc on the prop's type declaration. */
	description: z.string().optional(),
	/** Default value expression from destructuring or `@default` tag. */
	defaultValue: z.string().optional(),
	/** Whether the prop uses the `$bindable()` rune, enabling two-way binding. */
	bindable: z.boolean().default(false),
	/**
	 * Structured parameters for callable props (e.g., `Snippet<[text: string]>`).
	 *
	 * Present when the prop has extractable parameters, absent otherwise.
	 * Only populated when there are actual parameters — bare `Snippet` / `Snippet<[]>`
	 * does not set this field. Intentionally `.optional()` rather than
	 * `.default([])` (see the array-field policy note above): absence is a
	 * meaningful signal, not an empty list.
	 */
	parameters: z.array(ParameterJson).optional(),
	...docFields,
});
export type ComponentPropJson = z.infer<typeof ComponentPropJson>;
export type ComponentPropJsonInput = z.input<typeof ComponentPropJson>;

/**
 * A single function overload signature.
 *
 * When a function has multiple overload signatures, each public overload
 * is captured here. The implementation signature is excluded.
 */
export const OverloadJson = z.strictObject({
	/** Full TypeScript type signature for this overload. */
	typeSignature: z.string(),
	/** Parameters for this overload. */
	parameters: z.array(ParameterJson).default([]),
	/** Return type for this overload. */
	returnType: z.string().optional(),
	/** Generic type parameters for this overload. */
	genericParams: z.array(GenericParamJson).default([]),
	/** JSDoc/TSDoc comment specific to this overload. */
	docComment: z.string().optional(),
	/** Return value description from `@returns` tag on this overload. */
	returnDescription: z.string().optional(),
});
export type OverloadJson = z.infer<typeof OverloadJson>;
export type OverloadJsonInput = z.input<typeof OverloadJson>;

/**
 * The subset of declaration kinds that appear as nested members in classes, interfaces, and types.
 *
 * Class members include constructors (`'constructor'`), methods (`'function'`),
 * and properties/accessors (`'variable'`). Interface/type properties use the same kinds
 * for property signatures, method signatures, index signatures, and call/construct signatures.
 *
 * Top-level-only kinds (`'class'`, `'interface'`, `'type'`, `'enum'`, `'component'`) never
 * appear as members — nesting is exactly one level deep.
 */
export const MemberKind = z.enum(['function', 'variable', 'constructor']);
export type MemberKind = z.infer<typeof MemberKind>;

/**
 * Shared Zod fields for both `MemberJson` and all `DeclarationJson` variants.
 *
 * Contains fields present on every declaration and member regardless of kind:
 * identity, documentation, modifiers, source location, and generic params.
 */
const declarationSharedFields = {
	/**
	 * The exported name. Always populated. The default-export slot is named
	 * `'default'` — that's the symbol's actual name in JS
	 * (`import {default as X}` and `ns.default` both expose it directly), and
	 * `import X from 'mod'` is sugar for `import {default as X}`. Consumers
	 * branch on `name === 'default'` to render the sugar form when desired.
	 */
	name: z.string(),
	/**
	 * Declaration kind — placeholder for key ordering.
	 * Each variant and `MemberJson` override with a narrower literal/enum.
	 * Placed here so `kind` appears right after `name` in serialized JSON
	 * (JS object spread preserves first-occurrence key position).
	 */
	kind: DeclarationKind,
	/** JSDoc/TSDoc comment. */
	docComment: z.string().optional(),
	/** Full TypeScript type signature. */
	typeSignature: z.string().optional(),
	/** TypeScript modifiers like `readonly`, `static`, or `protected`. */
	modifiers: z.array(DeclarationModifier).default([]),
	/**
	 * 1-indexed line number in source file.
	 * Undefined for synthesized declarations (e.g., alias declarations from renamed re-exports).
	 */
	sourceLine: z.number().optional(),
	/** Generic type parameters like `<T, U>`. */
	genericParams: z.array(GenericParamJson).default([]),
	...docFields,
	/**
	 * Mutation documentation from `@mutates` tags (non-standard), mapping keys to descriptions.
	 *
	 * Keys are intentionally unvalidated — typically a parameter name, but
	 * authors may also use compound paths (`this.foo`, `obj.field`) or external
	 * state references (`globalCache`). The schema accepts any string key so
	 * consumers can render whatever the author wrote.
	 */
	mutates: z.record(z.string(), z.string()).optional(),
	/** Whether extraction failed partway through, leaving some fields missing (e.g., `typeSignature`, `parameters`). */
	partial: z.boolean().default(false),
} as const;

/** Callable fields shared by functions and constructors (but not variables). */
const callableFields = {
	/** Function/method/constructor parameters. */
	parameters: z.array(ParameterJson).default([]),
	/**
	 * Overload signatures (when there are multiple public overloads).
	 * Includes all public overloads. The implementation signature is excluded.
	 * Empty when there are no overloads (single signature).
	 */
	overloads: z.array(OverloadJson).default([]),
} as const;

/** Return-value fields for functions only (not constructors or variables). */
const returnFields = {
	/** Function/method return type. */
	returnType: z.string().optional(),
	/** Return value description from `@returns` tag. */
	returnDescription: z.string().optional(),
} as const;

/** Function-like fields shared by `FunctionMemberJson` and `FunctionDeclarationJson`. */
const functionLikeFields = {
	...callableFields,
	...returnFields,
} as const;

// ── MemberJson Variants ────────────────────────────────────────────────────

/**
 * A function member (method, call signature, method signature).
 * Has `parameters`, `returnType`, `returnDescription`, `overloads`.
 *
 * `optional` reflects a `?` token on the declaration (e.g., `foo?(): void`
 * on an interface or type literal). Always `false` for index/call/construct
 * signatures and for class methods (TypeScript disallows optional methods on
 * classes).
 *
 * `name` is the user-chosen method/property identifier, except for call
 * signatures on interfaces and type aliases where it is the literal sentinel
 * `'(call)'`.
 */
export const FunctionMemberJson = z.strictObject({
	...declarationSharedFields,
	...functionLikeFields,
	kind: z.literal('function'),
	/**
	 * User-chosen identifier, or the literal `'(call)'` sentinel for
	 * unnamed call signatures.
	 */
	name: z.string(),
	/** Whether the member has a `?` token in its declaration. */
	optional: z.boolean().default(false),
});
export type FunctionMemberJson = z.infer<typeof FunctionMemberJson>;

/**
 * A variable member (property, accessor, index signature, enum value).
 * Shared fields plus optional `reactivity` for class fields initialized with
 * a Svelte rune (`$state`, `$state.raw`, `$derived`, `$derived.by`).
 *
 * `optional` reflects a `?` token on the declaration (e.g., `x?: string`).
 * Always `false` for index signatures and enum values.
 */
export const VariableMemberJson = z.strictObject({
	...declarationSharedFields,
	kind: z.literal('variable'),
	/** Whether the member has a `?` token in its declaration. */
	optional: z.boolean().default(false),
	/** Rune flavor when this field is initialized with a value-producing reactivity rune. */
	reactivity: Reactivity.optional(),
	/** Default value documented via `@default`. Authoritative initializer (when human-readable) is in `typeSignature`. */
	defaultValue: z.string().optional(),
});
export type VariableMemberJson = z.infer<typeof VariableMemberJson>;

/**
 * A constructor member (class constructor, construct signature).
 * Has `parameters`, `overloads` — but not `returnType`/`returnDescription`
 * (constructors always return their class).
 *
 * `name` is narrowed to two literal sentinels: `'constructor'` for class
 * constructors and `'(construct)'` for interface/type-alias construct
 * signatures (which share `kind: 'constructor'` but originate from
 * `getConstructSignatures()` on a non-class type — no user-chosen identifier
 * exists). The literal is preserved (rather than omitted) so `getDisplayName`
 * and consumer renderers reading `member.name` keep working without a
 * constructor-specific branch.
 */
export const ConstructorMemberJson = z.strictObject({
	...declarationSharedFields,
	...callableFields,
	kind: z.literal('constructor'),
	name: z.union([z.literal('constructor'), z.literal('(construct)')]),
});
export type ConstructorMemberJson = z.infer<typeof ConstructorMemberJson>;

/**
 * Metadata for a nested declaration within a class, interface, type, or enum.
 *
 * Discriminated union on `kind` with 3 variants: `FunctionMemberJson`,
 * `VariableMemberJson`, `ConstructorMemberJson`. Use `isKind` (in
 * `declaration-helpers.ts`) to narrow, or check `member.kind` directly.
 *
 * Does not include fields that exist on declarations but not on members
 * (`extends`, `intersects`, `implements`, `props`, `alsoExportedFrom`, `aliasOf`).
 *
 * Nesting is exactly one level deep — members never contain their own members.
 */
export const MemberJson: z.ZodDiscriminatedUnion<
	[typeof FunctionMemberJson, typeof VariableMemberJson, typeof ConstructorMemberJson],
	'kind'
> = z.discriminatedUnion('kind', [FunctionMemberJson, VariableMemberJson, ConstructorMemberJson]);
export type MemberJson = z.infer<typeof MemberJson>;
export type MemberJsonInput = z.input<typeof MemberJson>;

// ── DeclarationJson Variants ────────────────────────────────────────────────

/** Top-level-only fields shared by all `DeclarationJson` variants. */
const declarationTopLevelFields = {
	/**
	 * Module paths (relative to `sourceRoot`) that re-export this declaration under the same name.
	 * The canonical declaration lives in this module's `declarations` array;
	 * these paths are additional import locations for the same thing.
	 *
	 * The same edges appear from the re-exporting side as `ModuleJson.reExports`
	 * — use that when asking "what does this module re-export" instead of
	 * inverting these arrays. The two can disagree at the margins: a `reExports`
	 * entry whose canonical declaration is `@nodocs` (or whose module isn't in
	 * the analyzed set) has no back-link here.
	 *
	 * **Consumer note**: To build a complete re-export map, scan two fields:
	 * 1. `alsoExportedFrom` on each declaration — same-name re-exports
	 * 2. `aliasOf` on declarations — renamed re-exports (separate declarations)
	 */
	alsoExportedFrom: z.array(z.string()).default([]),
	/**
	 * For renamed re-exports (`export {foo as bar}`), points to the original declaration.
	 * This declaration's `name` is the alias; `aliasOf.name` is the original name.
	 *
	 * For renames out of the default slot (`export {default as bar} from './x'` where
	 * `./x` is `export default ...`), `aliasOf.name` is `'default'` — the canonical's
	 * actual symbol name. Consumers locate the canonical by `(aliasOf.module, aliasOf.name)`.
	 *
	 * Svelte component exception: when the source is a `.svelte` file (e.g.,
	 * `export {default as Foo} from './X.svelte'`), the canonical's name is the
	 * component name (derived from the filename), so `aliasOf.name` is the
	 * component name (`'X'`), NOT `'default'`. Consumers that branch on
	 * `aliasOf.name === 'default'` to detect default-rename should additionally
	 * check whether `aliasOf.module` ends with `.svelte`.
	 *
	 * Different from `alsoExportedFrom`: aliases create new API surface names,
	 * while `alsoExportedFrom` tracks additional import paths for the same name.
	 */
	aliasOf: z
		.strictObject({
			module: z.string(),
			name: z.string(),
		})
		.optional(),
} as const;

/** A function declaration. Has `parameters`, `returnType`, `returnDescription`, `overloads`. */
export const FunctionDeclarationJson = z.strictObject({
	...declarationSharedFields,
	...declarationTopLevelFields,
	...functionLikeFields,
	kind: z.literal('function'),
});
export type FunctionDeclarationJson = z.infer<typeof FunctionDeclarationJson>;

/** A class declaration. Has `members`, `extends`, `implements`. */
export const ClassDeclarationJson = z.strictObject({
	...declarationSharedFields,
	...declarationTopLevelFields,
	kind: z.literal('class'),
	/**
	 * Extended base class (single; TypeScript allows only one).
	 *
	 * @see `implements` (this variant), `InterfaceDeclarationJson.extends`,
	 *   `TypeDeclarationJson.intersects`, `ComponentDeclarationJson.intersects`
	 *   for sibling "related type identifiers" fields. Field shapes mirror TS syntax.
	 */
	extends: z.string().optional(),
	/** Implemented interfaces. */
	implements: z.array(z.string()).default([]),
	/**
	 * Class members: methods, properties, constructors, getters/setters.
	 */
	members: z.array(MemberJson).default([]),
});
export type ClassDeclarationJson = z.infer<typeof ClassDeclarationJson>;

/** An interface declaration. Has `members`, `extends`. */
export const InterfaceDeclarationJson = z.strictObject({
	...declarationSharedFields,
	...declarationTopLevelFields,
	kind: z.literal('interface'),
	/**
	 * Extended interfaces.
	 *
	 * @see `ClassDeclarationJson.extends`, `ClassDeclarationJson.implements`,
	 *   `TypeDeclarationJson.intersects`, `ComponentDeclarationJson.intersects`
	 *   for sibling "related type identifiers" fields. Field shapes mirror TS syntax.
	 */
	extends: z.array(z.string()).default([]),
	/**
	 * Interface members: property signatures, method signatures, index signatures,
	 * call/construct signatures.
	 */
	members: z.array(MemberJson).default([]),
});
export type InterfaceDeclarationJson = z.infer<typeof InterfaceDeclarationJson>;

/** A type alias declaration. Has `members`, `intersects`. */
export const TypeDeclarationJson = z.strictObject({
	...declarationSharedFields,
	...declarationTopLevelFields,
	kind: z.literal('type'),
	/**
	 * Types from intersection branches whose properties are all external (filtered out of `members`).
	 *
	 * @see `ComponentDeclarationJson.intersects`, `ClassDeclarationJson.extends`,
	 *   `ClassDeclarationJson.implements`, `InterfaceDeclarationJson.extends`
	 *   for sibling "related type identifiers" fields. Field shapes mirror TS syntax.
	 */
	intersects: z.array(z.string()).default([]),
	/**
	 * Type members: property signatures, method signatures, index signatures,
	 * call/construct signatures.
	 */
	members: z.array(MemberJson).default([]),
});
export type TypeDeclarationJson = z.infer<typeof TypeDeclarationJson>;

/**
 * A variable declaration. Has optional `reactivity` for top-level rune-module
 * exports (e.g., `export let count = $state(0)` in `.svelte.ts` or `<script module>`).
 */
export const VariableDeclarationJson = z.strictObject({
	...declarationSharedFields,
	...declarationTopLevelFields,
	kind: z.literal('variable'),
	/** Rune flavor when this variable is initialized with a value-producing reactivity rune. */
	reactivity: Reactivity.optional(),
	/** Default value documented via `@default`. Useful when the AST initializer is opaque (a call expression, computed value) and the author wants to document the conceptual default. */
	defaultValue: z.string().optional(),
});
export type VariableDeclarationJson = z.infer<typeof VariableDeclarationJson>;

/** An enum declaration. Has `members` for enum values. */
export const EnumDeclarationJson = z.strictObject({
	...declarationSharedFields,
	...declarationTopLevelFields,
	kind: z.literal('enum'),
	/** Enum members: name/value pairs with optional JSDoc. */
	members: z.array(MemberJson).default([]),
});
export type EnumDeclarationJson = z.infer<typeof EnumDeclarationJson>;

/** A Svelte component declaration. Has `props`, `intersects`, `acceptsChildren`. */
export const ComponentDeclarationJson = z.strictObject({
	...declarationSharedFields,
	...declarationTopLevelFields,
	kind: z.literal('component'),
	/**
	 * Types from intersection branches whose properties are all external (filtered out of `props`).
	 *
	 * @see `TypeDeclarationJson.intersects`, `ClassDeclarationJson.extends`,
	 *   `ClassDeclarationJson.implements`, `InterfaceDeclarationJson.extends`
	 *   for sibling "related type identifiers" fields. Field shapes mirror TS syntax.
	 */
	intersects: z.array(z.string()).default([]),
	/** Svelte component props. */
	props: z.array(ComponentPropJson).default([]),
	/** Whether the component accepts children (explicit `children` prop, inherited, or implicit template usage). */
	acceptsChildren: z.boolean().default(false),
	/** Script language. `undefined` means TypeScript (default), `'js'` for JavaScript-only components. */
	lang: z.enum(['js']).optional(),
});
export type ComponentDeclarationJson = z.infer<typeof ComponentDeclarationJson>;

/** A Svelte snippet declaration exported from `<script module>`. Has `parameters`. */
export const SnippetDeclarationJson = z.strictObject({
	...declarationSharedFields,
	...declarationTopLevelFields,
	kind: z.literal('snippet'),
	/** Snippet parameters. */
	parameters: z.array(ParameterJson).default([]),
});
export type SnippetDeclarationJson = z.infer<typeof SnippetDeclarationJson>;

/**
 * A namespace re-export binding: `export * as ns from './x'`.
 *
 * Carries no inline members — `module` points to the source module whose
 * declarations are projected under this name. Consumers that want to render
 * `ns.a` can deref by reading the source module's `declarations` array.
 */
export const NamespaceDeclarationJson = z.strictObject({
	...declarationSharedFields,
	...declarationTopLevelFields,
	kind: z.literal('namespace'),
	/** Source module path (relative to `sourceRoot`) projected under this binding. */
	module: z.string(),
});
export type NamespaceDeclarationJson = z.infer<typeof NamespaceDeclarationJson>;

/**
 * Metadata for an exported declaration (function, type, class, component, etc.).
 *
 * Discriminated union on `kind` — each variant has only the fields relevant to that kind.
 * Use `isKind` (in `declaration-helpers.ts`) to narrow, or check `declaration.kind` directly.
 */
export const DeclarationJson: z.ZodDiscriminatedUnion<
	[
		typeof FunctionDeclarationJson,
		typeof ClassDeclarationJson,
		typeof InterfaceDeclarationJson,
		typeof TypeDeclarationJson,
		typeof VariableDeclarationJson,
		typeof EnumDeclarationJson,
		typeof ComponentDeclarationJson,
		typeof SnippetDeclarationJson,
		typeof NamespaceDeclarationJson,
	],
	'kind'
> = z.discriminatedUnion('kind', [
	FunctionDeclarationJson,
	ClassDeclarationJson,
	InterfaceDeclarationJson,
	TypeDeclarationJson,
	VariableDeclarationJson,
	EnumDeclarationJson,
	ComponentDeclarationJson,
	SnippetDeclarationJson,
	NamespaceDeclarationJson,
]);
export type DeclarationJson = z.infer<typeof DeclarationJson>;
export type DeclarationJsonInput = z.input<typeof DeclarationJson>;

/**
 * A same-name re-export edge, from the re-exporting module's side.
 *
 * Each entry on `ModuleJson.reExports` records that the module's source
 * contains `export {name} from ...` where the canonical declaration lives in
 * `module`. This is the forward view of the same fact that
 * `alsoExportedFrom` records on the canonical declaration — consumers
 * resolve the canonical by `(module, name)`, the same lookup contract as
 * `aliasOf`.
 *
 * Same-name re-exports of analyzed source only. Renamed re-exports appear as
 * declarations with `aliasOf` in the re-exporting module; star exports live
 * in `ModuleJson.starExports`; external re-exports in
 * `ModuleJson.externalReExports` / `externalStarExports`. Use
 * `resolveExportSurface` (in `postprocess.ts`) to combine all of these into
 * a module's full export surface — it handles the name dedup (a documented
 * same-name re-export appears both here and as a synthesized alias
 * declaration) and the ES star semantics (explicit exports shadow
 * star-projected ones, names ambiguous between stars are excluded,
 * `default` doesn't project).
 *
 * `module` points at the *canonical* module (multi-hop chains are resolved),
 * not the immediate specifier in the export statement. For Svelte default-slot
 * re-exports (`export {default} from './X.svelte'`), `name` is the component
 * name derived from the filename (`'X'`), matching the canonical declaration's
 * name — the same exception documented on `aliasOf`. Because of that
 * re-keying, two entries in one module can share a `name` (a re-keyed
 * component colliding with a same-name re-export from another module);
 * `(module, name)` pairs remain unique (exact duplicates are deduped at
 * construction).
 *
 * `@nodocs` on the export statement suppresses the entry (and the
 * `alsoExportedFrom` back-link). When the canonical declaration itself is
 * `@nodocs`, or the canonical module isn't part of the analyzed set, the
 * entry still exists but has no matching back-link — the same presence
 * caveat as `aliasOf.module` and `starExports`.
 */
export const ReExportJson = z.strictObject({
	/** Exported name — the canonical declaration's name in `module`. */
	name: z.string(),
	/** Module path (relative to `sourceRoot`) where the canonical declaration lives. */
	module: z.string(),
	/**
	 * Whether the statement (`export type {A} from ...`) or specifier
	 * (`export {type A} from ...`) is type-only — the name is erased at
	 * runtime and importable only via `import type`.
	 */
	typeOnly: z.boolean().default(false),
	/**
	 * 1-based line of the export specifier in this module's source. When
	 * identical `(name, module)` edges are deduped (Svelte default-slot
	 * re-keying), the smallest line is kept.
	 */
	sourceLine: z.number().optional(),
});
export type ReExportJson = z.infer<typeof ReExportJson>;
export type ReExportJsonInput = z.input<typeof ReExportJson>;

/**
 * A re-export whose immediate target is outside the analyzed source set —
 * `export {x} from 'pkg'`, `export {x as y} from 'pkg'`, or
 * `export * as ns from 'pkg'`.
 *
 * `specifier` is the module specifier as written (usually a package name);
 * there is no canonical declaration to resolve, so these entries are flat
 * facts about the statement rather than edges into the module graph.
 *
 * Only statements that *directly* reference the external specifier are
 * captured. Forms that stay silent: `import {x} from 'pkg'; export {x};`
 * (import-then-export), re-export chains that reach a package through
 * another source module (that module owns the entry), and specifiers the
 * checker can't resolve. Statement-level `@nodocs` suppresses the entry.
 */
export const ExternalReExportJson = z.strictObject({
	/** Public exported name from this module. */
	name: z.string(),
	/** Module specifier as written in the statement (e.g. `'pkg'`). */
	specifier: z.string(),
	/**
	 * The name inside the external module when renamed
	 * (`export {x as y} from 'pkg'` → `'x'`). Omitted for same-name
	 * re-exports and namespace form (`export * as ns`).
	 */
	originalName: z.string().optional(),
	/** Whether the statement or specifier is type-only — see `ReExportJson.typeOnly`. */
	typeOnly: z.boolean().default(false),
	/** 1-based line of the export specifier in this module's source. */
	sourceLine: z.number().optional(),
});
export type ExternalReExportJson = z.infer<typeof ExternalReExportJson>;
export type ExternalReExportJsonInput = z.input<typeof ExternalReExportJson>;

/**
 * Metadata for a source module — the top-level container in the data model.
 *
 * `analyze` and `analyzeFromFiles` return `Array<ModuleJson>` sorted alphabetically by `path`.
 * Each module contains its exported `declarations`, dependency graph, and optional `moduleComment`.
 */
export const ModuleJson = z.strictObject({
	/**
	 * Path relative to `sourceRoot` (e.g., `helpers.ts` for the default
	 * SvelteKit `src/lib` layout). `sourceRoot` is configurable via
	 * `createSourceOptions` / the CLI `--source-root` flag — consumers with a
	 * custom layout (e.g., `sourcePaths: ['src/lib', 'src/routes']`,
	 * `sourceRoot: 'src'`) see prefixes like `lib/foo.ts` here.
	 */
	path: z.string(),
	/** Exported declarations from this module. */
	declarations: z.array(DeclarationJson).default([]),
	/** File-level JSDoc comment (from `@module` tag). */
	moduleComment: z.string().optional(),
	/** Modules this imports (paths relative to `sourceRoot`). */
	dependencies: z.array(z.string()).default([]),
	/** Modules that import this (paths relative to `sourceRoot`). */
	dependents: z.array(z.string()).default([]),
	/**
	 * Modules fully re-exported via `export * from './module'`.
	 * Paths are relative to `sourceRoot`. Statement-level `@nodocs`
	 * suppresses the entry, like the other re-export encodings.
	 */
	starExports: z.array(z.string()).default([]),
	/**
	 * Same-name re-exports in this module's source, sorted by `name` then
	 * `module` (names can collide — see `ReExportJson`). The forward view of
	 * `alsoExportedFrom` — see `ReExportJson` for the full contract (canonical
	 * resolution, Svelte default-slot naming, `@nodocs` suppression, presence
	 * caveats).
	 */
	reExports: z.array(ReExportJson).default([]),
	/**
	 * Re-exports whose immediate target is an external package, sorted by
	 * `name` then `specifier`. See `ExternalReExportJson` for which forms
	 * are captured.
	 */
	externalReExports: z.array(ExternalReExportJson).default([]),
	/**
	 * External modules fully re-exported via `export * from 'pkg'`, as
	 * written (statement order). The projected names are unknown — the
	 * package isn't analyzed. Statement-level `@nodocs` suppresses the
	 * entry; unresolvable specifiers are skipped.
	 */
	externalStarExports: z.array(z.string()).default([]),
	/**
	 * Whether the module is a placeholder for a file that couldn't be analyzed.
	 *
	 * Currently only set for Svelte files where svelte2tsx threw at ingest
	 * (the `transform_failed` diagnostic carries the error). Placeholder
	 * modules have `declarations: []` and serve as a structural slot so the
	 * `modules` array reflects the full owned set; consumers render them as
	 * "broken" entries.
	 */
	partial: z.boolean().default(false),
});
export type ModuleJson = z.infer<typeof ModuleJson>;
export type ModuleJsonInput = z.input<typeof ModuleJson>;
