/**
 * Metadata types for library source code analysis.
 *
 * These types represent the structure of `src/lib/` exports,
 * extracted at build time via TypeScript compiler analysis.
 * Used for generating API documentation and enabling code search.
 *
 * Hierarchy: `ModuleJson` → `DeclarationJson` (discriminated union on `kind`) → `MemberJson` (discriminated union on `kind`)
 *
 * ## Input/output split
 *
 * The schemas are valibot schemas. Array fields default to `[]` and boolean
 * flags to `false` (`v.optional(schema, default)`), so they're optional in
 * serialized JSON (compact) but guaranteed after parsing. Input types
 * (`ModuleJsonInput`, `DeclarationJsonInput`, `ComponentPropJsonInput`) accept
 * the omitted fields; output types (`ModuleJson`, `DeclarationJson`,
 * `ComponentPropJson`) guarantee them. Use `compactReplacer` (in
 * `declaration-helpers.ts`) with `JSON.stringify` for compact output, and
 * `parseModuleJson` (or `parseAnalyzeResult` in `analyze-core.ts`) to
 * validate and restore the defaults — the parse helpers are the stable
 * entry points, independent of the schema library.
 *
 * Array defaults are factories (`() => []`): valibot returns a non-function
 * default as-is, so a literal `[]` would be one array shared by every parse.
 *
 * ## Discriminated union
 *
 * `DeclarationJson` is a `v.variant` on `kind` with 9 variants:
 * `FunctionDeclarationJson`, `ClassDeclarationJson`, `InterfaceDeclarationJson`,
 * `TypeDeclarationJson`, `VariableDeclarationJson`, `EnumDeclarationJson`,
 * `ComponentDeclarationJson`, `SnippetDeclarationJson`, `NamespaceDeclarationJson`.
 * Each variant has only the fields relevant to that kind, enforced by
 * `v.strictObject`. Use `isKind` (in `declaration-helpers.ts`) to narrow.
 *
 * `MemberJson` is similarly a `v.variant` on `kind` with 3 variants:
 * `FunctionMemberJson`, `VariableMemberJson`, `ConstructorMemberJson`.
 * Each variant has only the fields relevant to that member kind.
 *
 * Internal analysis code that constructs declarations incrementally uses
 * `DeclarationJsonBuild` — a permissive interface with all fields optional.
 * Validation at the `parseModuleJson` boundary enforces variant correctness.
 *
 * @see `declaration-helpers.ts` for display formatting and type narrowing utilities
 * @see `analyze.ts` for the main analysis entry points
 * @see `tsdoc.ts` for JSDoc/TSDoc extraction into these types
 * @see `postprocess.ts` for post-processing (`mergeReExports`, `findDuplicates`)
 *
 * @module
 */

import * as v from 'valibot';

import { parseWithSummary, type Named } from './schema.ts';

/**
 * The kind of top-level exported declaration.
 *
 * Does not include `'constructor'` — constructors only appear as `MemberKind`
 * (nested in classes, interfaces, or types with construct signatures), never as
 * top-level module exports.
 */
export const DeclarationKind = v.picklist([
	'type',
	'function',
	'variable',
	'class',
	'interface',
	'enum',
	'component',
	'snippet',
	'namespace'
]);
export type DeclarationKind = v.InferOutput<typeof DeclarationKind>;

/**
 * TypeScript modifier keywords extracted from declarations.
 *
 * Only modifiers that appear on public API members are included.
 * Private members (including `#field` syntax) are filtered out during analysis.
 * Protected members are included as part of the extension API.
 */
export const DeclarationModifier = v.picklist([
	'public',
	'protected',
	'readonly',
	'static',
	'abstract',
	'getter',
	'setter'
]);
export type DeclarationModifier = v.InferOutput<typeof DeclarationModifier>;

/**
 * Reactivity flavor for a variable declaration or class field, captured from
 * the rune call at the initializer (e.g., `let count = $state(0)`).
 *
 * Only the value-producing reactivity runes are represented here — `$props`
 * and `$bindable` are modeled separately as `ComponentPropJson.bindable`
 * (and prop-presence on the `props` array), which a legacy `export let` prop
 * sets too. A renderer wanting "all rune
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
export const Reactivity = v.picklist(['$state', '$state.raw', '$derived', '$derived.by']);
export type Reactivity = v.InferOutput<typeof Reactivity>;

// Each exported object schema is named through an interface (`FooSchema`) so
// the emitted declarations reference it by name. Inferred, a schema's type is
// written out structurally at every use, nested schemas included, which
// multiplies the declarations' size. Naming keeps them referential and small.
// It also keeps consumers' typechecking shallow: over a fully inlined
// `ModuleJson`, `v.InferOutput` exceeds TypeScript's instantiation depth
// (TS2589), which this repo's own typecheck never sees. A name on that heavy
// root is enough to clear the error, and the rest are there for size.
// `dist-types.test.ts` guards both. `Named` is the identity alias that lets an
// interface extend a `typeof` query.

const GenericParamJsonImpl = v.strictObject({
	/** Parameter name like `T`. */
	name: v.string(),
	/** Constraint like `string` from `T extends string`. */
	constraint: v.optional(v.string()),
	/** Default type like `unknown` from `T = unknown`. */
	defaultType: v.optional(v.string())
});
/** @nodocs */
export interface GenericParamJsonSchema extends Named<typeof GenericParamJsonImpl> {}
/**
 * Generic type parameter metadata extracted from declarations like `<T extends string = unknown>`.
 *
 * Present on functions, classes, interfaces, type aliases, and Svelte components
 * that declare generic type parameters.
 */
export const GenericParamJson: GenericParamJsonSchema = GenericParamJsonImpl;
export type GenericParamJson = v.InferOutput<typeof GenericParamJson>;

/**
 * Structured type information — the machine-readable counterpart to the flat
 * type strings (`ParameterJson.type`, `ComponentPropJson.type`, the
 * `typeSignature` fields that carry a `typeInfo` sibling, and `returnType`
 * beside `returnTypeInfo`).
 *
 * **Absence contract**: the field holding a `TypeJson` is absent when the flat
 * string is the whole story — the type is terminal at the root (an intrinsic,
 * a plain object literal, a function type, a bare named reference). Present
 * only when the node carries structure the string can't: union/intersection
 * members, reference type arguments, enumerable literals; an array or tuple
 * qualifies when an element does (`readonly` alone doesn't — the flat string
 * carries it, except at alias roots where the relaxation emits the tree
 * regardless). A reference over the *empty* tuple is the one instantiation
 * that doesn't qualify: `Snippet<[]>` prints itself in full, so the tree would
 * wrap nothing (`Snippet<[a: string]>` still qualifies — its tuple has
 * elements). Nested nodes inside
 * a present tree are always populated (they have no flat-string sibling).
 *
 * One exception, on `TypeDeclarationJson` for type aliases: the checker prints
 * an aliased type as its bare alias name, so `type StrArr = string[]` has
 * `typeSignature: "StrArr"` — no flat sibling to defer to. There the tree is
 * emitted whatever its shape, except for object and function roots, whose
 * content the declaration's own `members` already carries. Interned types
 * (intrinsics, literals) don't carry an alias symbol and print structurally,
 * so `type Str = string` is still absent.
 *
 * **Expansion policy**: unions and intersections recurse into `members`; named
 * references keep `name` plus recursive `typeArgs`; arrays carry their
 * `element`; tuples carry `elements` (label, `?`/`...` markers, recursive
 * type); both mark `readonly` when written so (`readonly Tome[]`,
 * `ReadonlyArray<Tome>`, `readonly [a, b]`). Everything else is terminal:
 * object literals, function types, and
 * unclassified types (type parameters, conditional types, module objects)
 * carry only
 * `text`. Object property maps are deliberately not expanded. Recursion is
 * depth-capped; nodes past the cap degrade to `{kind: 'other', text}`.
 *
 * **Alias policy**: `alias` is emitted whenever the checker reports an alias
 * symbol, root or nested — for a root node it may duplicate the flat string
 * (`type: "ColorScheme"` beside `alias: "ColorScheme"`), which is accepted for
 * uniformity: nested nodes have no flat sibling, and consumers get one lookup
 * key (`alias` on composites, `name` on references) at any depth. This covers
 * the composite kinds only. An aliased object type becomes a `reference` under
 * its alias name.
 *
 * svelte2tsx-generated aliases don't count. A component whose props have no
 * name of their own (an inline `$props()` annotation, a JS component's JSDoc)
 * types them through svelte2tsx's `$$ComponentProps`, which nothing exports;
 * a legacy component with slots, through the shims'
 * `__sveltets_2_PropsWithChildren`. The tree treats those aliases as absent:
 * they're never a `name` or `alias`, a project alias over one
 * (`type P = ComponentProps<typeof Button>`) recovers like any alias-lost type
 * (below), and where nothing recovers the structure is expanded. A root whose
 * flat string is the generated name, bare or as an array or tuple element
 * (`$$ComponentProps[]`), keeps its tree, except object and function roots of
 * a type alias, whose `members` carry them. The flat strings still print
 * `$$ComponentProps`. Generated names inside a terminal node's `text`
 * (`{ a: $$ComponentProps; }`, or an `other` node past the depth cap) are
 * printed as the checker prints them.
 *
 * **Callable classification**: callability is the load-bearing renderer
 * signal, so anything with a call signature is a `function` node — with one
 * narrow exception: a *named generic instantiation* (checker
 * `Reference`-flagged, symbol-named, carrying type arguments) classifies as a
 * `reference` even when callable, so `Snippet<[a: string]>` is a `reference`
 * whose tuple typeArg carries real elements, and an alias over one, nested,
 * references by the alias name (`type MySnippet = Snippet<[string]>` in a
 * union is `{kind: 'reference', name: 'MySnippet'}`; at its own declaration
 * root the self-alias skip applies and the `Snippet` reference shows
 * through). Bare signatures (`() => void`), aliased function types, and
 * anonymous or hybrid callables — non-generic callable interfaces included —
 * stay `function`, so their name survives only inside `text`
 * (`type Handler = (e: Event) => void` nested in a union is
 * `{kind: 'function', text: 'Handler'}`, which a whole-string type-link lookup
 * still resolves, but a structural walk can't distinguish from a printed
 * signature).
 *
 * **Normalization**: the optional-widening `undefined` member is dropped from a
 * root union like the flat string drops it (`optional: true` carries it) — but
 * the flat string strips at the top level only, while the tree strips at every
 * `optional`-flagged position it expands, so `Snippet<[a: string, b?: number]>`
 * prints `b?: number | undefined` while the tuple element reports `number` with
 * `optional: true`. Treat `typeSignature` as the checker's canonical rendering
 * and the structured fields as normalized. At property sites the strip applies
 * only when the checker widened: under `exactOptionalPropertyTypes` an
 * author-written `undefined` on an optional property is kept (parameters and
 * tuple elements always strip). Separately, a `true | false` literal pair
 * collapses to the `boolean` intrinsic (the checker expands `boolean` inside
 * unions). A union reduced to one member by either rule becomes that member
 * directly, never a 1-member union.
 *
 * Terminal `text` fields are printed with `NoTruncation` up to a 1000-char
 * budget, past which the checker's own elided rendering is used — so `text` is
 * always a well-formed type string, and one node can't grow without bound the
 * way the depth cap prevents for the tree. The flat strings keep the checker's
 * default ~160-char truncation throughout (they are the checker's canonical
 * rendering; see `getTypeSignature`). The budget bites only on types whose
 * alias TypeScript dropped — an alias over an indexed access or conditional
 * (`z.infer<typeof S>`, valibot's `InferOutput`) carries no alias symbol, so
 * the checker expands its whole structure at every use.
 *
 * **Written-name recovery**: at each annotated position, each bare type
 * reference is resolved by checker type identity, and a type the checker has
 * no name for — the alias-dropped shapes above — emits
 * `{kind: 'reference', name}` instead of expanding, alias-lost unions and
 * intersections included. The annotated positions: return types (per overload
 * too), parameters, variables, type-alias declarations, properties of type
 * aliases, interfaces, and classes, index signatures, accessors (the getter's
 * return, else a setter-only accessor's parameter), component props, and
 * snippet parameters. The name resolves through import aliases to the
 * importable one (`import {Original as Renamed}` recovers `Original`); a name
 * the checker has is never overridden; `typeof` queries, import types, inline
 * type literals, and argument-carrying references (`z.infer<typeof S>` itself,
 * `Extract<D, {kind: K}>` — whose bare symbol name would misrepresent the
 * instantiation) never recover. A recovered bare reference is emitted even at
 * the root, relaxing the absence contract the way alias roots do: a
 * checker-named bare reference defers to a flat sibling printing the same
 * name, while a recovered one stands against the anonymous expansion, so the
 * name exists only in the tree. Both recovery channels still fire at the depth
 * cap, so a capped alias-lost type emits its reference instead of elided text.
 * A lost union written as one member of a larger union (`LostUnion | null`,
 * `'z' | LostUnion`) recovers as one `reference` member at its written
 * position, though the checker flattens its members into the outer union: the
 * written reference is the only trace left, so this needs a written union
 * (at the site, or an alias right-hand side like `type Opt = LostUnion | null`,
 * which then recovers at every use). It falls back to the expanded members
 * when they don't all survive as distinct members — `string` absorbing a
 * literal member (`LostUnion | string`), or a member written earlier
 * overlapping one (`'a' | LostUnion`) — and for a lost union that includes
 * `undefined` at an optional position, whose `undefined` the widening strip
 * removed, since the member-set match can't tell that strip from a type
 * operator removing `undefined` (`Exclude<LostUnion, undefined>`).
 *
 * **Registry recovery**: behind the written channel, unannotated positions
 * recover through the analyzed set's alias registry — any exported,
 * non-`@nodocs`, non-generic lost alias of an emitted module, matched by
 * checker type identity. A registry-recovered reference additionally carries
 * `module`, the declaring module's `ModuleJson.path` — provenance for
 * collision-exact linking, and always an emitted module (gated modules never
 * register), so a consumer lookup by `(module, name)` can't dangle. `module`
 * appears only on registry-recovered references: written-channel recoveries
 * name whatever the author wrote (which may not be the registry's winner), and
 * checker-named references and alias-carrying `union`/`intersection` nodes
 * carry no provenance. Consumers must handle absence.
 *
 * **Member order and nested aliases**: union members follow the **written**
 * order wherever a written union node is recoverable: the alias declaration's
 * right-hand side for a non-generic aliased union (covering every use,
 * inferred ones included), else the annotation at the site. `null`/`undefined`
 * still sink last, and a member written as a named sub-union survives as its
 * own alias-carrying `union` node (`ColorScheme` stays nested, not flattened
 * literals) when the checker kept it grouped, and a written lost union as its
 * recovered `reference` (see written-name recovery). Elsewhere — inferred unions,
 * `keyof`, mapped and conditional results, generic alias instantiations —
 * members follow the checker's internal order, which depends on
 * type-creation history and can shift with unrelated edits. Flat strings
 * always print in the checker's order, so tree and flat string can list the
 * same members in different orders (written `ColorScheme | number` prints
 * `number | ColorScheme`); the tree is the one to read for author intent, such
 * as control options. One edge: the site lookup matches by member set, so a
 * union takes the order (and lost-union grouping) of the first union written
 * over the same members anywhere in that annotation — two written unions in
 * different orders (`['a' | 'b', 'b' | 'a']`) both read `"a" | "b"`, and an
 * unwritten one there (`Exclude<…>`) borrows a written one's order.
 */
export type TypeJson =
	/** A built-in type: `string`, `number`, `boolean`, `null`, `undefined`, `void`, `any`, `unknown`, `never`, `symbol`, `bigint`, `object`. */
	| { kind: 'intrinsic'; text: string }
	/**
	 * A literal type. `value` is the runtime value; `text` is the printed form —
	 * quoted for plain literals (`"'a'"` prints as `"a"`), the qualified member
	 * name for enum literals (`MyEnum.FOO`), so `{value, text}` doubles as a
	 * `{value, label}` pair for enum-aware consumers.
	 *
	 * A value JSON can't carry is a string instead, so every node serializes
	 * and round-trips: a bigint literal is its printed text (`1n` has `value`
	 * `"1n"`), and a non-finite number is its `String()` form — `"Infinity"`,
	 * `"-Infinity"`, or `"NaN"`. Those arise from a literal that overflows
	 * (`1e999`) and from enum members initialized to one (`A = 1 / 0`,
	 * `B = 0 / 0`). A number `value` is therefore always finite. A string
	 * `value` doesn't say on its own whether the literal is a string: for a
	 * plain literal `text` does, quoted only for a string (`"Infinity"` against
	 * `Infinity`), while an enum member's `text` is its name either way.
	 */
	| { kind: 'literal'; value: string | number | boolean; text: string }
	/**
	 * A named type reference: an interface, class, aliased object type, or
	 * generic instantiation — callable instantiations like `Snippet<[a: string]>`
	 * included (see the callable-classification policy above). `typeArgs` is
	 * present only for generic instantiations (`Map<string, Tome>`); a bare
	 * reference carries `name` alone. `module` — the declaring module's
	 * `ModuleJson.path`, always one this output emits — is present only on
	 * registry-recovered references (see the registry-recovery policy above).
	 */
	| { kind: 'reference'; name: string; module?: string; typeArgs?: Array<TypeJson> }
	/** An array type (`Tome[]`, `Array<Tome>`); `readonly` (emitted only when `true`) marks `readonly Tome[]` / `ReadonlyArray<Tome>`. */
	| { kind: 'array'; element: TypeJson; readonly?: boolean }
	/**
	 * A tuple type (`[a: string, b?: number]`); `readonly` (emitted only when
	 * `true`) marks `readonly [...]`. `elements` is absent for the empty tuple
	 * (`[]`, e.g. bare `Snippet`'s type argument) — absent, never `[]`, which
	 * `compactReplacer` would strip from the wire with no schema default to
	 * restore it. An empty tuple is also the one node that says nothing, so a
	 * reference over it doesn't qualify under the absence contract above; it
	 * appears only nested inside a tree something else earned.
	 */
	| { kind: 'tuple'; elements?: Array<TupleElementJson>; readonly?: boolean }
	/** A union; `alias` when written through a named alias (or an enum's name). */
	| { kind: 'union'; alias?: string; members: Array<TypeJson> }
	/** An intersection; `alias` when written through a named alias. */
	| { kind: 'intersection'; alias?: string; members: Array<TypeJson> }
	/**
	 * A function type, terminal: `text` only, no parameter structure. Covers
	 * anything with a call signature except named generic instantiations, which
	 * classify as `reference` (see the callable-classification policy above).
	 * `text` is whatever the checker prints, which is the alias or
	 * interface name when the type has one.
	 */
	| { kind: 'function'; text: string }
	/** An anonymous object type, terminal: `text` only, no property structure. */
	| { kind: 'object'; text: string }
	/**
	 * Anything unclassified — type parameters, conditional types, module
	 * objects (`typeof import("dep.ts")`, whose symbol name is the quoted
	 * specifier and so is never emitted as a `reference`) — or past the depth
	 * cap.
	 */
	| { kind: 'other'; text: string };

/**
 * One element of a `{kind: 'tuple'}` node.
 *
 * `optional` and `rest` are emitted only when `true`, matching the tree's
 * meaningful-absence optionality (unlike `ParameterJson`'s defaulted
 * booleans, so the recursive schema keeps input = output).
 */
export interface TupleElementJson {
	/** The written label of a named tuple member (`[a: string]`). */
	name?: string;
	/**
	 * The element's type. An optional element's type has the widening
	 * `undefined` stripped so `optional` carries it alone (the enclosing flat
	 * string keeps it — see the normalization policy); a rest element's is
	 * the array it collects (`...rest: boolean[]` carries an `array` node over
	 * `boolean`, matching the written form), while a variadic spread of an
	 * unresolved type (`...T`) carries the spread type itself.
	 */
	type: TypeJson;
	/** The element's `?` marker; emitted only when `true`. */
	optional?: boolean;
	/** The element's `...` marker; emitted only when `true`. */
	rest?: boolean;
}

// the recursive positions go through `v.lazy`, never the variant itself:
// valibot calls a lazy getter on every parse, so wrapping the whole variant
// would rebuild it at each node, while these getters only read the bindings
// below (resolved at parse time, after both consts are initialized)
export const TypeJson: v.GenericSchema<TypeJson> = v.variant('kind', [
	v.strictObject({ kind: v.literal('intrinsic'), text: v.string() }),
	v.strictObject({
		kind: v.literal('literal'),
		value: v.union([v.string(), v.pipe(v.number(), v.finite()), v.boolean()]),
		text: v.string()
	}),
	v.strictObject({
		kind: v.literal('reference'),
		name: v.string(),
		module: v.optional(v.string()),
		typeArgs: v.optional(v.array(v.lazy(() => TypeJson)))
	}),
	v.strictObject({
		kind: v.literal('array'),
		element: v.lazy(() => TypeJson),
		readonly: v.optional(v.boolean())
	}),
	v.strictObject({
		kind: v.literal('tuple'),
		elements: v.optional(v.array(v.lazy(() => TupleElementJson))),
		readonly: v.optional(v.boolean())
	}),
	v.strictObject({
		kind: v.literal('union'),
		alias: v.optional(v.string()),
		members: v.array(v.lazy(() => TypeJson))
	}),
	v.strictObject({
		kind: v.literal('intersection'),
		alias: v.optional(v.string()),
		members: v.array(v.lazy(() => TypeJson))
	}),
	v.strictObject({ kind: v.literal('function'), text: v.string() }),
	v.strictObject({ kind: v.literal('object'), text: v.string() }),
	v.strictObject({ kind: v.literal('other'), text: v.string() })
]);

// declared after `TypeJson` so its `type` field can reference the const
// directly; `TypeJson`'s lazy getters resolve this binding at parse time
export const TupleElementJson: v.GenericSchema<TupleElementJson> = v.strictObject({
	name: v.optional(v.string()),
	type: TypeJson,
	optional: v.optional(v.boolean()),
	rest: v.optional(v.boolean())
});

/**
 * A map of author-written string keys to strings (`@mutates` targets, dotted
 * `@param` sub-paths).
 *
 * Not `v.record(v.string(), v.string())`, which silently drops the
 * `constructor` and `prototype` keys — legitimate keys here
 * (`@mutates constructor`). Accepts a plain object whose own values are all
 * strings, and copies them into a fresh object. Each non-string value gets its
 * own issue, with the key on the issue path. An own `__proto__` key (which
 * `JSON.parse` can produce) is skipped entirely, its value never checked.
 */
const StringRecord: v.GenericSchema<Record<string, string>> = v.pipe(
	v.custom<Record<string, string>>((input) => {
		if (typeof input !== 'object' || input === null) return false;
		const proto: unknown = Object.getPrototypeOf(input);
		return proto === Object.prototype || proto === null;
	}, 'Invalid type: Expected a record of strings'),
	v.rawCheck(({ dataset, addIssue }) => {
		if (!dataset.typed) return;
		const input: Record<string, unknown> = dataset.value;
		for (const [key, value] of Object.entries(input)) {
			if (key === '__proto__' || typeof value === 'string') continue;
			addIssue({
				message: `Invalid type: Expected string but received ${describeReceived(value)}`,
				expected: 'string',
				input: value,
				path: [{ type: 'object', origin: 'value', input, key, value }]
			});
		}
	}),
	v.transform((input) => {
		const copy: Record<string, string> = {};
		for (const key of Object.keys(input)) {
			if (key !== '__proto__') copy[key] = input[key]!;
		}
		return copy;
	})
);

/** Names a rejected value for an issue message: its JSON for a primitive, else its type. */
const describeReceived = (value: unknown): string => {
	if (value === null || value === undefined) return String(value);
	if (Array.isArray(value)) return 'Array';
	if (typeof value === 'object') return 'Object';
	if (typeof value === 'function' || typeof value === 'symbol') return typeof value;
	return typeof value === 'bigint' ? `${value}n` : JSON.stringify(value);
};

const ParameterJsonImpl = v.strictObject({
	/**
	 * Parameter name (e.g., `options`, `args`); rest-ness is carried by `rest`,
	 * never the name.
	 */
	name: v.string(),
	/** Resolved TypeScript type string (e.g., `string`, `Record<string, unknown>`). */
	type: v.string(),
	/** Structured type; absent when `type` is the whole story (see `TypeJson`). */
	typeInfo: v.optional(TypeJson),
	/**
	 * Whether a caller may omit the argument, by the checker's
	 * `isOptionalParameter`: a `?` token, an initializer with no required
	 * parameter after it (`b = 0`), and in JS a bracketed `@param {T} [b]` or
	 * `@param {T=} b`. When set, `type` and `typeInfo` drop a top-level
	 * `undefined` (the optional widening, or one an initialized parameter's
	 * type already holds), so `optional` carries it alone. A rest parameter is
	 * never `optional`.
	 */
	optional: v.optional(v.boolean(), false),
	/** Whether the parameter uses rest syntax (`...args`). */
	rest: v.optional(v.boolean(), false),
	/** Description from `@param` tag. */
	description: v.optional(v.string()),
	/**
	 * The initializer's source text, verbatim (e.g., `"'hello'"`, `42`,
	 * `() => 10`) — quotes included, no normalization; consumers render it as
	 * highlighted TS. Without an initializer, the default a bracketed
	 * `@param {T} [b=0]` writes, verbatim the same way.
	 */
	defaultValue: v.optional(v.string()),
	/**
	 * Descriptions for properties of a named object parameter, from dotted
	 * `@param` tags (`@param obj.prop - ...`), the ones TypeScript nests under
	 * a braced `@param {object} obj` included.
	 *
	 * Keyed by the sub-path relative to this parameter — `@param obj.prop`
	 * becomes `{prop: '...'}`, `@param obj.a.b` becomes `{'a.b': '...'}`, and
	 * an array element's `@param arr[].prop` becomes `{'[].prop': '...'}`.
	 * Keys are unvalidated against the parameter's actual type (matching the
	 * `@mutates` philosophy); absent when no dotted `@param` tags reference
	 * this parameter. Only populated for function/method/constructor
	 * signature parameters.
	 *
	 * Matching is by the parameter's name, so destructured parameters
	 * (`fn({a, b}: T)`) are not covered — TypeScript names them `__0`, with no
	 * author-facing identifier for a `@param` key to reference.
	 */
	propertyDescriptions: v.optional(StringRecord)
});
/** @nodocs */
export interface ParameterJsonSchema extends Named<typeof ParameterJsonImpl> {}
/**
 * Parameter information for functions and methods.
 *
 * Kept distinct from `ComponentPropJson` despite structural similarity.
 * Function parameters form a tuple with positional semantics:
 * calling order matters (`fn(a, b)` vs `fn(b, a)`),
 * may include rest parameters and destructuring patterns.
 *
 * Carries no doc fields beyond `description`, unlike `ComponentPropJson`: a
 * parameter's docs come from one `@param` line, while a prop has a JSDoc block
 * of its own.
 */
export const ParameterJson: ParameterJsonSchema = ParameterJsonImpl;
export type ParameterJson = v.InferOutput<typeof ParameterJson>;
export type ParameterJsonInput = v.InferInput<typeof ParameterJson>;

/**
 * Doc-comment fields shared across declarations, members, and component props.
 *
 * Extracted so `declarationSharedFields` and `ComponentPropJson` reference
 * the same field definitions without duplication.
 */
const docFields = {
	/** Code examples from `@example` tags. */
	examples: v.optional(v.array(v.string()), () => []),
	/** Deprecation message from `@deprecated` tag. */
	deprecatedMessage: v.optional(v.string()),
	/** Related items from `@see` tags, in raw TSDoc format. */
	seeAlso: v.optional(v.array(v.string()), () => []),
	/** Exceptions from `@throws` tags. */
	throws: v.optional(
		v.array(v.strictObject({ type: v.optional(v.string()), description: v.string() })),
		() => []
	),
	/** Version introduced, from `@since` tag. */
	since: v.optional(v.string()),
	/**
	 * Internal-API marker from the `@internal` tag. Presence means the tag was
	 * written; an empty string is a bare tag with no trailing prose.
	 *
	 * A marker, not an exclusion: `@internal` means "not stable public API"
	 * (TSDoc semantics) while the declaration, member, or prop stays
	 * documented — unlike `@nodocs`, which removes a declaration from output
	 * entirely (and is ignored on props and members).
	 */
	internalMessage: v.optional(v.string()),
	/**
	 * Mutation documentation from `@mutates` tags (non-standard), mapping keys to descriptions.
	 *
	 * Keys are intentionally unvalidated — typically a parameter name, but
	 * authors may also use compound paths (`this.foo`, `obj.field`) or
	 * multi-word external state references. Backticks are stripped from keys
	 * so `` `a` `` and `a` normalize to one key; an empty-string value is a
	 * bare tag with no description. The schema accepts any string key so
	 * consumers can render whatever the author wrote.
	 *
	 * On a component prop it declares the component's mutation contract for
	 * the value it's handed: the component writes into the prop's object or
	 * array in place (`@mutates items - appends the selected entry`,
	 * `@mutates options.cache - fills on first render`). Reassigning a prop is
	 * not a mutation in this sense (`bindable` covers it), though a `$bindable`
	 * prop can carry both.
	 */
	mutates: v.optional(StringRecord)
} as const;

/**
 * The `docFields` a module comment carries — all but `throws` and `mutates`,
 * which describe a declaration's behavior. Spread into `ModuleJson`.
 */
const { throws: _throws, mutates: _mutates, ...moduleDocFields } = docFields;

const ComponentPropJsonImpl = v.strictObject({
	/**
	 * Prop name as declared in the component's `$props()` type — the prop's own
	 * name, not the local binding a renamed destructuring element introduces.
	 */
	name: v.string(),
	/** Resolved TypeScript type string. */
	type: v.string(),
	/** Structured type; absent when `type` is the whole story (see `TypeJson`). */
	typeInfo: v.optional(TypeJson),
	/** Whether the prop is optional in the component's props type. */
	optional: v.optional(v.boolean(), false),
	/** Description from JSDoc on the prop's type declaration. */
	description: v.optional(v.string()),
	/**
	 * The destructuring default's source text, else the `@default` tag text —
	 * verbatim author text either way (`"'primary'"`, `() => 10`), quotes
	 * included, no normalization; consumers render it as highlighted TS.
	 */
	defaultValue: v.optional(v.string()),
	/**
	 * Whether the prop supports two-way binding (`bind:name`): declared with the
	 * `$bindable()` rune, or any prop of a legacy `export let` component, where
	 * every prop can be bound.
	 */
	bindable: v.optional(v.boolean(), false),
	/**
	 * Structured parameters for callable props: a snippet's
	 * (`Snippet<[text: string]>`) or a callback's (`(value: string) => void`).
	 * `returnType` tells the two apart — a callback has one, a snippet doesn't.
	 *
	 * Present when the prop has extractable parameters, absent otherwise.
	 * Only populated when there are actual parameters — bare `Snippet` /
	 * `Snippet<[]>` and a zero-parameter callback do not set this field.
	 * Intentionally optional without a default, unlike the other array fields
	 * (see the input/output split in the module comment): absence is a
	 * meaningful signal, not an empty list.
	 */
	parameters: v.optional(v.array(ParameterJson)),
	/**
	 * A callback prop's return type, and the marker that the prop is one:
	 * present exactly when the prop's type has a call signature this project
	 * declared (`onpick?: (value: string) => void`, or a project alias for
	 * one). `parameters` holds that signature's parameters.
	 *
	 * The prop's type is read with `null` and the optional `undefined`
	 * stripped, so `(() => void) | null` is a callback. A union of several
	 * function types is not — `typeInfo` lists its members instead.
	 *
	 * Only project-declared signatures count, as for callable members. A prop
	 * typed wholly by a package (`MouseEventHandler<HTMLButtonElement>`, a
	 * `Component`) carries neither field, since an external callable isn't
	 * always a callback. In an intersection of an own signature with an
	 * external one (`MouseEventHandler<HTMLElement> & (() => void)`, the
	 * shape a redeclared `onclick` over an attributes bag takes), the own
	 * signature is the one described. Of several own signatures, the first.
	 */
	returnType: v.optional(v.string()),
	/** Structured return type; absent when `returnType` is the whole story (see `TypeJson`). */
	returnTypeInfo: v.optional(TypeJson),
	...docFields
});
/** @nodocs */
export interface ComponentPropJsonSchema extends Named<typeof ComponentPropJsonImpl> {}
/**
 * Component prop information for Svelte components.
 *
 * Standalone schema (not extending `ParameterJson`) because component props
 * have different semantics: named attributes with no positional order
 * (`<Foo {a} {b} />` = `<Foo {b} {a} />`), no rest parameters,
 * and support for two-way binding (the `$bindable` rune, or a legacy
 * `export let` prop).
 */
export const ComponentPropJson: ComponentPropJsonSchema = ComponentPropJsonImpl;
export type ComponentPropJson = v.InferOutput<typeof ComponentPropJson>;
export type ComponentPropJsonInput = v.InferInput<typeof ComponentPropJson>;

const ComponentCssPropertyJsonImpl = v.strictObject({
	/** The custom property's name as written, `--` included (`--a_color`); case-sensitive, as in CSS. */
	name: v.string(),
	/** The `@cssprop` tag's description, raw like `docComment`. Only on a `documented` entry. */
	description: v.optional(v.string()),
	/**
	 * The `@cssprop` tag's braced syntax (`@cssprop {<color>} --a` gives
	 * `<color>`), verbatim, unvalidated. Only on a `documented` entry.
	 */
	syntax: v.optional(v.string()),
	/**
	 * The value the property takes when unset: a `@cssprop` tag's bracketed
	 * default (`@cssprop [--a=1px]` gives `1px`), else the fallback of the
	 * first `var()` read with one, the verbatim source text after the comma,
	 * trimmed, comments included (`var(--a, var(--b, 1px))` gives
	 * `var(--b, 1px)`). Empty for `var(--a,)`, a fallback of nothing. Absent
	 * for a documented property no read gives a fallback and no tag a default.
	 */
	fallback: v.optional(v.string()),
	/**
	 * 1-based line in the original `.svelte` source of the property's first
	 * `var()` read, or for a documented property the component never reads,
	 * of its `@cssprop` tag.
	 */
	sourceLine: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
	/**
	 * Whether a `@cssprop` tag in the component's doc comment documents the
	 * property, as opposed to the fallback-read heuristic finding it alone.
	 * A consumer can list only the documented entries when a component has
	 * any, dropping the global tokens the heuristic also catches.
	 */
	documented: v.optional(v.boolean(), false)
});
/** @nodocs */
export interface ComponentCssPropertyJsonSchema extends Named<
	typeof ComponentCssPropertyJsonImpl
> {}
/**
 * A CSS custom property in a Svelte component's styling API: one a consumer
 * sets on the component (`<A --a_color="red" />`) or on an ancestor, read by
 * the component's `<style>`.
 *
 * @see `ComponentDeclarationJson.cssCustomProperties` for which reads count
 */
export const ComponentCssPropertyJson: ComponentCssPropertyJsonSchema =
	ComponentCssPropertyJsonImpl;
export type ComponentCssPropertyJson = v.InferOutput<typeof ComponentCssPropertyJson>;
export type ComponentCssPropertyJsonInput = v.InferInput<typeof ComponentCssPropertyJson>;

const OverloadJsonImpl = v.strictObject({
	/** Full TypeScript type signature for this overload. */
	typeSignature: v.string(),
	/** Parameters for this overload. */
	parameters: v.optional(v.array(ParameterJson), () => []),
	/** Return type for this overload. */
	returnType: v.optional(v.string()),
	/** Structured return type; absent when `returnType` is the whole story (see `TypeJson`). */
	returnTypeInfo: v.optional(TypeJson),
	/** Generic type parameters for this overload. */
	genericParams: v.optional(v.array(GenericParamJson), () => []),
	/** JSDoc/TSDoc comment specific to this overload. */
	docComment: v.optional(v.string()),
	/** Return value description from `@returns` tag on this overload. */
	returnDescription: v.optional(v.string())
});
/** @nodocs */
export interface OverloadJsonSchema extends Named<typeof OverloadJsonImpl> {}
/**
 * A single function overload signature.
 *
 * When a function has multiple overload signatures, each public overload
 * is captured here. The implementation signature is excluded.
 */
export const OverloadJson: OverloadJsonSchema = OverloadJsonImpl;
export type OverloadJson = v.InferOutput<typeof OverloadJson>;
export type OverloadJsonInput = v.InferInput<typeof OverloadJson>;

/**
 * The subset of declaration kinds that appear as nested members in classes, interfaces, and types.
 *
 * Class members include constructors (`'constructor'`), methods (`'function'`),
 * and properties/accessors (`'variable'`). Interface/type properties use the same kinds
 * for property signatures, method signatures, index signatures, and call/construct signatures.
 *
 * Every other `DeclarationKind` is top-level only; nesting is exactly one level deep.
 */
export const MemberKind = v.picklist(['function', 'variable', 'constructor']);
export type MemberKind = v.InferOutput<typeof MemberKind>;

/**
 * Shared schema fields for both `MemberJson` and all `DeclarationJson` variants.
 *
 * Contains fields present on every declaration and member regardless of kind:
 * identity, documentation, modifiers, source location, and generic params.
 */
const declarationSharedFields = {
	/**
	 * The exported name. Always populated. The default-export slot is named
	 * `'default'`, except a Svelte component, which takes its filename-derived
	 * name (`'X'` for `X.svelte`) — `'default'` is the symbol's actual name in JS
	 * (`import {default as X}` and `ns.default` both expose it directly), and
	 * `import X from 'mod'` is sugar for `import {default as X}`. Consumers
	 * branch on `name === 'default'` to render the sugar form when desired.
	 */
	name: v.string(),
	/**
	 * Declaration kind — placeholder for key ordering.
	 * Each variant and `MemberJson` override with a narrower literal/enum.
	 * Placed here so `kind` appears right after `name` in serialized JSON
	 * (JS object spread preserves first-occurrence key position).
	 */
	kind: DeclarationKind,
	/** JSDoc/TSDoc comment. */
	docComment: v.optional(v.string()),
	/** Full TypeScript type signature. */
	typeSignature: v.optional(v.string()),
	/** TypeScript modifiers like `readonly`, `static`, or `protected`. */
	modifiers: v.optional(v.array(DeclarationModifier), () => []),
	/**
	 * 1-indexed line number in source file.
	 * Synthesized aliases (see `aliasOf`) carry the local export specifier's line, not the
	 * canonical's.
	 */
	sourceLine: v.optional(v.pipe(v.number(), v.finite())),
	/** Generic type parameters like `<T, U>`. */
	genericParams: v.optional(v.array(GenericParamJson), () => []),
	...docFields,
	/** Whether extraction failed partway through, leaving some fields missing (e.g., `typeSignature`, `parameters`). */
	partial: v.optional(v.boolean(), false)
} as const;

/** Callable fields shared by functions and constructors (but not variables). */
const callableFields = {
	/** Function/method/constructor parameters, in signature order. */
	parameters: v.optional(v.array(ParameterJson), () => []),
	/**
	 * Overload signatures (when there are multiple public overloads).
	 * Includes all public overloads. The implementation signature is excluded.
	 * Empty when there are no overloads (single signature).
	 */
	overloads: v.optional(v.array(OverloadJson), () => [])
} as const;

/** Return-value fields for functions only (not constructors or variables). */
const returnFields = {
	/** Function/method return type. */
	returnType: v.optional(v.string()),
	/** Structured return type; absent when `returnType` is the whole story (see `TypeJson`). */
	returnTypeInfo: v.optional(TypeJson),
	/** Return value description from `@returns` tag. */
	returnDescription: v.optional(v.string())
} as const;

/** Function-like fields shared by `FunctionMemberJson` and `FunctionDeclarationJson`. */
const functionLikeFields = {
	...callableFields,
	...returnFields
} as const;

// MemberJson Variants

const FunctionMemberJsonImpl = v.strictObject({
	...declarationSharedFields,
	...functionLikeFields,
	kind: v.literal('function'),
	/**
	 * User-chosen identifier, or the literal `'(call)'` sentinel for
	 * unnamed call signatures.
	 */
	name: v.string(),
	/** Whether the member has a `?` token in its declaration. */
	optional: v.optional(v.boolean(), false),
	/**
	 * Default value documented via `@default` — for a callable member,
	 * typically the behavior used when the callback is omitted. Always
	 * tag-authored (structural containers have no initializers), verbatim with
	 * no normalization. Members only: top-level function declarations and
	 * overloads never carry one.
	 */
	defaultValue: v.optional(v.string())
});
/** @nodocs */
export interface FunctionMemberJsonSchema extends Named<typeof FunctionMemberJsonImpl> {}
/**
 * A function member (method, call signature, method signature).
 * Has `parameters`, `returnType`, `returnDescription`, `overloads`.
 *
 * `optional` reflects a `?` token on the declaration (e.g., `foo?(): void`
 * on an interface or type literal, or `m?(): void {}` on a class). Always
 * `false` for index/call/construct signatures.
 *
 * `name` is the user-chosen method/property identifier, except for call
 * signatures on interfaces and type aliases where it is the literal sentinel
 * `'(call)'`.
 */
export const FunctionMemberJson: FunctionMemberJsonSchema = FunctionMemberJsonImpl;
export type FunctionMemberJson = v.InferOutput<typeof FunctionMemberJson>;

const VariableMemberJsonImpl = v.strictObject({
	...declarationSharedFields,
	kind: v.literal('variable'),
	/** Whether the member has a `?` token in its declaration. */
	optional: v.optional(v.boolean(), false),
	/** Rune flavor when this field is initialized with a value-producing reactivity rune. */
	reactivity: v.optional(Reactivity),
	/**
	 * Default value documented via `@default`, verbatim tag text with no
	 * normalization. Initializers aren't captured — a class field's
	 * `typeSignature` is its checker type, not its initializer.
	 */
	defaultValue: v.optional(v.string()),
	/**
	 * Structured type; absent when `typeSignature` is the whole story (see
	 * `TypeJson`). Member types are checker-backed everywhere — type-alias and
	 * interface properties and index signatures, class properties (annotated or
	 * inferred), and accessors (getter-backed or setter-only) all resolve
	 * through the checker, with written annotations feeding name recovery.
	 */
	typeInfo: v.optional(TypeJson)
});
/** @nodocs */
export interface VariableMemberJsonSchema extends Named<typeof VariableMemberJsonImpl> {}
/**
 * A variable member (property, accessor, index signature, enum value).
 * Shared fields plus optional `reactivity` for class fields initialized with
 * a Svelte rune (`$state`, `$state.raw`, `$derived`, `$derived.by`).
 *
 * `optional` reflects a `?` token on the declaration (e.g., `x?: string`).
 * Always `false` for index signatures and enum values.
 */
export const VariableMemberJson: VariableMemberJsonSchema = VariableMemberJsonImpl;
export type VariableMemberJson = v.InferOutput<typeof VariableMemberJson>;

const ConstructorMemberJsonImpl = v.strictObject({
	...declarationSharedFields,
	...callableFields,
	kind: v.literal('constructor'),
	name: v.union([v.literal('constructor'), v.literal('(construct)')])
});
/** @nodocs */
export interface ConstructorMemberJsonSchema extends Named<typeof ConstructorMemberJsonImpl> {}
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
export const ConstructorMemberJson: ConstructorMemberJsonSchema = ConstructorMemberJsonImpl;
export type ConstructorMemberJson = v.InferOutput<typeof ConstructorMemberJson>;

/**
 * Metadata for a nested declaration within a class, interface, type, or enum.
 *
 * Discriminated union on `kind` with 3 variants: `FunctionMemberJson`,
 * `VariableMemberJson`, `ConstructorMemberJson`. Use `isKind` (in
 * `declaration-helpers.ts`) to narrow, or check `member.kind` directly.
 *
 * Does not include fields that exist on declarations but not on members
 * (`extends`, `externalTypes`, `implements`, `props`, `alsoExportedFrom`, `aliasOf`).
 *
 * Nesting is exactly one level deep — members never contain their own members.
 */
export const MemberJson: v.VariantSchema<
	'kind',
	[typeof FunctionMemberJson, typeof VariableMemberJson, typeof ConstructorMemberJson],
	undefined
> = v.variant('kind', [FunctionMemberJson, VariableMemberJson, ConstructorMemberJson]);
export type MemberJson = v.InferOutput<typeof MemberJson>;
export type MemberJsonInput = v.InferInput<typeof MemberJson>;

// DeclarationJson Variants

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
	alsoExportedFrom: v.optional(v.array(v.string()), () => []),
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
	 *
	 * A type-only rename of a value (`export type {someConst as c} from './x'`)
	 * synthesizes a normal alias — declarations carry no type-only marker.
	 */
	aliasOf: v.optional(
		v.strictObject({
			/**
			 * The canonical's `ModuleJson.path` — relative to `sourceRoot`, like
			 * every module reference in the schema and unlike `Diagnostic.file`.
			 * May name a module absent from output when the canonical is gated
			 * (the `internal/` convention) — a documented margin.
			 */
			module: v.string(),
			name: v.string()
		})
	)
} as const;

const FunctionDeclarationJsonImpl = v.strictObject({
	...declarationSharedFields,
	...declarationTopLevelFields,
	...functionLikeFields,
	kind: v.literal('function')
});
/** @nodocs */
export interface FunctionDeclarationJsonSchema extends Named<typeof FunctionDeclarationJsonImpl> {}
/** A function declaration. Has `parameters`, `returnType`, `returnDescription`, `overloads`. */
export const FunctionDeclarationJson: FunctionDeclarationJsonSchema = FunctionDeclarationJsonImpl;
export type FunctionDeclarationJson = v.InferOutput<typeof FunctionDeclarationJson>;

const ClassDeclarationJsonImpl = v.strictObject({
	...declarationSharedFields,
	...declarationTopLevelFields,
	kind: v.literal('class'),
	/**
	 * Extended base class — 0 or 1 entries (TypeScript allows only one base).
	 * An array so every heritage field (`extends`, `implements`,
	 * `externalTypes`, `InterfaceDeclarationJson.extends`) shares one shape;
	 * consumers iterate heritage uniformly instead of branching on kind.
	 *
	 * Verbatim text of this declaration's own heritage clause (as is
	 * `implements`), so it is spelled as this module wrote it and resolves in
	 * its scope — a local rename stays the local name, where `externalTypes`
	 * resolves renames because its walk crosses modules.
	 *
	 * @see `implements` (this variant), `InterfaceDeclarationJson.extends`
	 *   for the other verbatim heritage fields, `externalTypes` (this variant)
	 *   for the resolved external reach.
	 */
	extends: v.optional(v.array(v.string()), () => []),
	/**
	 * External types the `extends` chain reaches whose contributions `members`
	 * never enumerates — the class counterpart of
	 * `InterfaceDeclarationJson.externalTypes`, descending through local base
	 * classes. `implements` contributes nothing: an implemented interface adds
	 * no members, the class declares its own.
	 *
	 * Entry normalization (rename resolution, type-parameter substitution,
	 * text-dedupe, source order) matches `TypeDeclarationJson.externalTypes`.
	 * A direct external base makes this textually equal to `extends`;
	 * consumers dedupe at render time.
	 */
	externalTypes: v.optional(v.array(v.string()), () => []),
	/** Implemented interfaces. */
	implements: v.optional(v.array(v.string()), () => []),
	/**
	 * Class members: methods, properties, constructors, getters/setters — own
	 * members only, inherited members excluded whatever their origin. Source
	 * order, except accessors (getter/setter pairs merged by name), which follow
	 * every other member.
	 */
	members: v.optional(v.array(MemberJson), () => [])
});
/** @nodocs */
export interface ClassDeclarationJsonSchema extends Named<typeof ClassDeclarationJsonImpl> {}
/** A class declaration. Has `members`, `extends`, `implements`. */
export const ClassDeclarationJson: ClassDeclarationJsonSchema = ClassDeclarationJsonImpl;
export type ClassDeclarationJson = v.InferOutput<typeof ClassDeclarationJson>;

const InterfaceDeclarationJsonImpl = v.strictObject({
	...declarationSharedFields,
	...declarationTopLevelFields,
	kind: v.literal('interface'),
	/**
	 * Extended interfaces.
	 *
	 * Verbatim text of this declaration's own heritage clause, so entries are
	 * spelled as this module wrote them and resolve in its scope — a local
	 * rename (`import type {Bag as B}`) stays `B`. Unlike `externalTypes`,
	 * whose walk crosses modules and therefore resolves renames back to the
	 * exported name, this clause never leaves the declaring file.
	 *
	 * @see `ClassDeclarationJson.extends`, `ClassDeclarationJson.implements`
	 *   for the other verbatim heritage fields, `externalTypes` (this variant)
	 *   for the resolved external reach.
	 */
	extends: v.optional(v.array(v.string()), () => []),
	/**
	 * External types the heritage composition reaches whose contributions
	 * `members` never enumerates.
	 *
	 * Interface members are own-only, so nothing is *filtered* — inherited
	 * content simply isn't listed. This field names the external types behind
	 * that absence: `interface Props extends HTMLButtonAttributes` records the
	 * bag directly, and `interface Props extends LocalBase` (where `LocalBase`
	 * reaches a bag) records it transitively — the same answer the component
	 * annotated with this interface gets, where `extends` alone dead-ends at a
	 * possibly-unexported local name. Inherited *local* content is the
	 * `extends` field's business: the base is documented at its own
	 * declaration.
	 *
	 * Entry normalization (rename resolution, type-parameter substitution,
	 * text-dedupe, source order) matches `TypeDeclarationJson.externalTypes`.
	 * Direct-heritage cases make this textually equal to `extends`; consumers
	 * dedupe at render time.
	 */
	externalTypes: v.optional(v.array(v.string()), () => []),
	/**
	 * Interface members: property signatures, method signatures, index
	 * signatures, call/construct signatures — own members only, inherited
	 * members excluded whatever their origin (call/construct signatures
	 * included: a base interface's `(call)` is not enumerated here). Source
	 * order, except call/construct signatures, which come last.
	 */
	members: v.optional(v.array(MemberJson), () => []),
	/**
	 * The exported name also carries a value meaning — a merged value+type
	 * symbol (`const Foo = ...` + `interface Foo {...}`), where the interface
	 * wins the declaration slot and the value's own type goes undocumented.
	 * Tells consumers the name is importable as a runtime value: `import
	 * {Foo}`, never `import type {Foo}` (see `generateImport`).
	 *
	 * @see `TypeDeclarationJson.mergedValue`
	 */
	mergedValue: v.optional(v.boolean(), false)
});
/** @nodocs */
export interface InterfaceDeclarationJsonSchema extends Named<
	typeof InterfaceDeclarationJsonImpl
> {}
/** An interface declaration. Has `members`, `extends`. */
export const InterfaceDeclarationJson: InterfaceDeclarationJsonSchema =
	InterfaceDeclarationJsonImpl;
export type InterfaceDeclarationJson = v.InferOutput<typeof InterfaceDeclarationJson>;

const TypeDeclarationJsonImpl = v.strictObject({
	...declarationSharedFields,
	...declarationTopLevelFields,
	kind: v.literal('type'),
	/**
	 * External types whose contributions are filtered out of `members`.
	 *
	 * Filtering is by declaration origin at every granularity — named
	 * properties, index signatures, call/construct signatures — so a purely
	 * structural external branch (an index-signature-only or callable-only
	 * interface) is recorded here exactly like a named-property bag. A
	 * declaration-less contribution (the index signature the checker
	 * synthesizes for a mapped-type instantiation like `Record<string, X>` or
	 * `Partial<Indexed>`) is kept in `members` and records nothing here.
	 *
	 * Covers every composition the written type reaches: an intersection or
	 * union branch, a bare or indexed-access reference, and a type composed
	 * behind a project-local name (`type Base = Bag & {…}`, a local
	 * interface's `extends`, a local container's accessed property
	 * `LocalMap['a']`). Entries carry the written form with two
	 * normalizations: an identifier bound by an import rename at the
	 * definition site (`import type {Bag as B}`) resolves back to the name its
	 * module exports, and a type parameter bound inside the descent
	 * substitutes its written argument (`interface A<T> extends ExtG<T>`
	 * reached via `extends A<string>` records `ExtG<string>`). Each distinct
	 * contributor appears once, in source order; a generic reference keeps its
	 * arguments. A local name is used only when it hides a definition the walk
	 * cannot traverse — a mapped or conditional type.
	 *
	 * Names carry no module, so the dedupe is by name alone: two *distinct*
	 * external types sharing an exported name (one from each of two packages)
	 * collapse to a single entry.
	 *
	 * @see `ComponentDeclarationJson.externalTypes`,
	 *   `InterfaceDeclarationJson.externalTypes`,
	 *   `ClassDeclarationJson.externalTypes` for the same field on the other
	 *   kinds, and `ClassDeclarationJson.extends`, `ClassDeclarationJson.implements`,
	 *   `InterfaceDeclarationJson.extends` for the verbatim own-clause heritage
	 *   fields. Field shapes mirror TS syntax.
	 */
	externalTypes: v.optional(v.array(v.string()), () => []),
	/**
	 * Structured type; absent when `typeSignature` is the whole story (see
	 * `TypeJson`). The headline case: a union alias's `typeSignature` prints as
	 * its own name (`ColorScheme`), and this field carries the enumerable
	 * members. Type aliases print as their own name for every non-interned
	 * type, so the tree is emitted there whatever its shape — the exception is
	 * object and function roots, whose content `members` already carries.
	 */
	typeInfo: v.optional(TypeJson),
	/**
	 * Type members: properties (property and method signatures) first, then
	 * index signatures (string, number), then call and construct signatures.
	 */
	members: v.optional(v.array(MemberJson), () => []),
	/**
	 * The exported name also carries a value meaning — a merged value+type
	 * symbol (`const Foo = z.strictObject({...})` + `type Foo = z.infer<typeof
	 * Foo>`, the schema/type pattern), where the type alias wins the
	 * declaration slot and the value's own type goes undocumented. Tells
	 * consumers the name is importable as a runtime value: `import {Foo}`,
	 * never `import type {Foo}` (see `generateImport`).
	 *
	 * @see `InterfaceDeclarationJson.mergedValue`
	 */
	mergedValue: v.optional(v.boolean(), false)
});
/** @nodocs */
export interface TypeDeclarationJsonSchema extends Named<typeof TypeDeclarationJsonImpl> {}
/** A type alias declaration. Has `members`, `externalTypes`. */
export const TypeDeclarationJson: TypeDeclarationJsonSchema = TypeDeclarationJsonImpl;
export type TypeDeclarationJson = v.InferOutput<typeof TypeDeclarationJson>;

const VariableDeclarationJsonImpl = v.strictObject({
	...declarationSharedFields,
	...declarationTopLevelFields,
	kind: v.literal('variable'),
	/** Rune flavor when this variable is initialized with a value-producing reactivity rune. */
	reactivity: v.optional(Reactivity),
	/**
	 * Default value documented via `@default`, verbatim tag text with no
	 * normalization. Useful when the AST initializer is opaque (a call
	 * expression, computed value) and the author wants to document the
	 * conceptual default.
	 */
	defaultValue: v.optional(v.string()),
	/** Structured type; absent when `typeSignature` is the whole story (see `TypeJson`). */
	typeInfo: v.optional(TypeJson)
});
/** @nodocs */
export interface VariableDeclarationJsonSchema extends Named<typeof VariableDeclarationJsonImpl> {}
/**
 * A variable declaration. Has optional `reactivity` for top-level rune-module
 * exports (e.g., `export let count = $state(0)` in `.svelte.ts` or `<script module>`).
 */
export const VariableDeclarationJson: VariableDeclarationJsonSchema = VariableDeclarationJsonImpl;
export type VariableDeclarationJson = v.InferOutput<typeof VariableDeclarationJson>;

const EnumDeclarationJsonImpl = v.strictObject({
	...declarationSharedFields,
	...declarationTopLevelFields,
	kind: v.literal('enum'),
	/** Enum members: name/value pairs with optional JSDoc. */
	members: v.optional(v.array(MemberJson), () => [])
});
/** @nodocs */
export interface EnumDeclarationJsonSchema extends Named<typeof EnumDeclarationJsonImpl> {}
/** An enum declaration. Has `members` for enum values. */
export const EnumDeclarationJson: EnumDeclarationJsonSchema = EnumDeclarationJsonImpl;
export type EnumDeclarationJson = v.InferOutput<typeof EnumDeclarationJson>;

const ComponentDeclarationJsonImpl = v.strictObject({
	...declarationSharedFields,
	...declarationTopLevelFields,
	kind: v.literal('component'),
	/**
	 * External types whose properties are filtered out of `props` — the
	 * attribute bags a component forwards, such as `HTMLButtonAttributes` or
	 * `SvelteHTMLElements['button']`. A bag stays listed when some of its
	 * properties are documented anyway because the `$props()` destructuring
	 * names them (see `props`).
	 *
	 * Covers every way props compose them: an intersection or union branch, a
	 * bare or indexed-access annotation, and `interface Props extends Bag`
	 * (directly or through a local base). Entries carry the written form with
	 * the same normalizations as `TypeDeclarationJson.externalTypes`: import
	 * renames at the definition site resolve to the exported name, and a type
	 * parameter bound inside the descent substitutes its written argument —
	 * `interface A<T> extends HTMLAttributes<T>` reached via `Props extends
	 * A<HTMLDivElement>` records `HTMLAttributes<HTMLDivElement>`. The
	 * component's *own* generics stay in scope and emit as written
	 * (`HTMLAttributes<T>` beside the `genericParams` documenting `T`). Each
	 * distinct bag appears once, in source order; a local name is used only
	 * when it hides a definition the walk cannot traverse (a mapped or
	 * conditional type). Names carry no module, so two distinct bags sharing
	 * an exported name collapse to one entry.
	 *
	 * @see `TypeDeclarationJson.externalTypes` for the full entry contract,
	 *   `InterfaceDeclarationJson.externalTypes` for the field on the props
	 *   interface itself. Field shapes mirror TS syntax.
	 */
	externalTypes: v.optional(v.array(v.string()), () => []),
	/**
	 * Svelte component props, in source order.
	 *
	 * Properties an external type contributes are left out (`externalTypes`
	 * names their bags), except the ones the `$props()` destructuring names:
	 * `type` in `let {type = 'button', ...rest}: HTMLButtonAttributes = $props()`
	 * is documented with the external declaration's type and JSDoc. Renamed
	 * (`class: className`) and nested (`a: {b}`) elements name their prop;
	 * the rest element names nothing, and a name the props type has only
	 * through an index signature isn't admitted. Admitted props follow the
	 * others, in destructuring order, since their declaration position is in
	 * a package.
	 */
	props: v.optional(v.array(ComponentPropJson), () => []),
	/**
	 * Whether the component accepts children: an explicit or inherited
	 * `Snippet`-typed `children` prop, implicit template usage, or a default
	 * slot (`<slot />` or a declared `$$Slots`) in a legacy component, one
	 * svelte2tsx reads as runes-less. A runes component's `<slot />` doesn't
	 * set it, and neither does a named slot alone.
	 */
	acceptsChildren: v.optional(v.boolean(), false),
	/**
	 * The component's styling API: the CSS custom properties its `<style>`
	 * reads with a fallback (`var(--a, 1px)`) and leaves for a consumer to set,
	 * plus the ones its doc comment documents with `@cssprop`. One entry per
	 * name: the documented ones first, in tag order, then the rest in the
	 * order of each name's first read.
	 *
	 * A read counts when it's an outermost `var()`, not one in another
	 * `var()`'s fallback: `var(--a, var(--b))` reads `--a`, with `--b` the
	 * fallback chain's global token. Reads anywhere in the stylesheet count,
	 * in `:global(…)` rules, nested rules, `@media`/`@container`/`@supports`
	 * blocks, and keyframes alike. A name drops out when the component sets
	 * it itself: a `--a: …` declaration in its `<style>`, a `style:--a`
	 * directive, or a `--a:` in a `style` attribute on one of its elements.
	 * A `--a` attribute on a child component doesn't count, since it styles
	 * the child. A name read only without a fallback isn't listed: bare reads
	 * are mostly global design tokens.
	 *
	 * `@cssprop --a - Description 1` (or `@cssproperty`) in the component's
	 * doc comment, the source that wins `docComment` (the in-script JSDoc
	 * over the HTML `@component` comment, the losing one's tags ignored),
	 * lists `--a` whatever the heuristic makes of it, `documented: true`, with
	 * the tag's `description`, `syntax`, and default (`fallback`). It merges
	 * with the read: a bare read, one nested in another's fallback, one the
	 * component sets itself, or one in its markup's static style text counts,
	 * giving `sourceLine` and, without a tag default, `fallback`. A name the
	 * component never reads stays, at the tag's line, and warns
	 * `unknown_cssprop`.
	 *
	 * Without tags, empty when the component has no `<style>`, when its
	 * style's `lang` (or `type`) names a preprocessor language
	 * (`css_lang_unsupported`), or when Svelte's parser rejects the component
	 * (`css_parse_failed`); tagged properties are listed even then.
	 */
	cssCustomProperties: v.optional(v.array(ComponentCssPropertyJson), () => []),
	/** Script language. `undefined` means TypeScript (default), `'js'` for JavaScript-only components. */
	lang: v.optional(v.picklist(['js']))
});
/** @nodocs */
export interface ComponentDeclarationJsonSchema extends Named<
	typeof ComponentDeclarationJsonImpl
> {}
/**
 * A Svelte component declaration. Has `props`, `externalTypes`, `acceptsChildren`,
 * `cssCustomProperties`.
 */
export const ComponentDeclarationJson: ComponentDeclarationJsonSchema =
	ComponentDeclarationJsonImpl;
export type ComponentDeclarationJson = v.InferOutput<typeof ComponentDeclarationJson>;

const SnippetDeclarationJsonImpl = v.strictObject({
	...declarationSharedFields,
	...declarationTopLevelFields,
	kind: v.literal('snippet'),
	/** Snippet parameters. */
	parameters: v.optional(v.array(ParameterJson), () => [])
});
/** @nodocs */
export interface SnippetDeclarationJsonSchema extends Named<typeof SnippetDeclarationJsonImpl> {}
/** A Svelte snippet declaration exported from `<script module>`. Has `parameters`. */
export const SnippetDeclarationJson: SnippetDeclarationJsonSchema = SnippetDeclarationJsonImpl;
export type SnippetDeclarationJson = v.InferOutput<typeof SnippetDeclarationJson>;

const NamespaceDeclarationJsonImpl = v.strictObject({
	...declarationSharedFields,
	...declarationTopLevelFields,
	kind: v.literal('namespace'),
	/** Source module path (relative to `sourceRoot`) projected under this binding. */
	module: v.string()
});
/** @nodocs */
export interface NamespaceDeclarationJsonSchema extends Named<
	typeof NamespaceDeclarationJsonImpl
> {}
/**
 * A namespace re-export binding: `export * as ns from './x'`.
 *
 * Carries no inline members — `module` points to the source module whose
 * declarations are projected under this name. Consumers that want to render
 * `ns.a` can deref by reading the source module's `declarations` array.
 *
 * Over a `.svelte` file with no svelte2tsx virtual (its transform failed, or
 * it was never supplied) the binding is `partial`: its members are unknown,
 * and `module` names the component's `partial` placeholder, or a module the
 * result lacks when the component emits nothing.
 */
export const NamespaceDeclarationJson: NamespaceDeclarationJsonSchema =
	NamespaceDeclarationJsonImpl;
export type NamespaceDeclarationJson = v.InferOutput<typeof NamespaceDeclarationJson>;

/**
 * Metadata for an exported declaration (function, type, class, component, etc.).
 *
 * Discriminated union on `kind` — each variant has only the fields relevant to that kind.
 * Use `isKind` (in `declaration-helpers.ts`) to narrow, or check `declaration.kind` directly.
 */
export const DeclarationJson: v.VariantSchema<
	'kind',
	[
		typeof FunctionDeclarationJson,
		typeof ClassDeclarationJson,
		typeof InterfaceDeclarationJson,
		typeof TypeDeclarationJson,
		typeof VariableDeclarationJson,
		typeof EnumDeclarationJson,
		typeof ComponentDeclarationJson,
		typeof SnippetDeclarationJson,
		typeof NamespaceDeclarationJson
	],
	undefined
> = v.variant('kind', [
	FunctionDeclarationJson,
	ClassDeclarationJson,
	InterfaceDeclarationJson,
	TypeDeclarationJson,
	VariableDeclarationJson,
	EnumDeclarationJson,
	ComponentDeclarationJson,
	SnippetDeclarationJson,
	NamespaceDeclarationJson
]);
export type DeclarationJson = v.InferOutput<typeof DeclarationJson>;
export type DeclarationJsonInput = v.InferInput<typeof DeclarationJson>;

const ReExportJsonImpl = v.strictObject({
	/** Exported name — the canonical declaration's name in `module`. */
	name: v.string(),
	/** Module path (relative to `sourceRoot`) where the canonical declaration lives. */
	module: v.string(),
	/**
	 * Whether the statement (`export type {A} from ...`) or specifier
	 * (`export {type A} from ...`) is type-only — the name is erased at
	 * runtime and importable only via `import type`. A type-only *rename*
	 * carries no such marker (see `aliasOf`).
	 */
	typeOnly: v.optional(v.boolean(), false),
	/**
	 * 1-based line of the export specifier in this module's source. When
	 * identical `(name, module)` edges are deduped (Svelte default-slot
	 * re-keying), the smallest line is kept.
	 */
	sourceLine: v.optional(v.pipe(v.number(), v.finite()))
});
/** @nodocs */
export interface ReExportJsonSchema extends Named<typeof ReExportJsonImpl> {}
/**
 * A same-name re-export edge, from the re-exporting module's side.
 *
 * Each entry on `ModuleJson.reExports` records that the module's source
 * contains `export {name} from ...`, or the import-then-export form it stands
 * for (`import {name} from ...; export {name}`, `export default X` over a
 * default import), where the canonical declaration lives in `module`. This
 * is the forward view of the same fact that `alsoExportedFrom` records on the
 * canonical declaration — consumers
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
 * re-exports (`export {default} from './X.svelte'`, or `import X from
 * './X.svelte'; export default X`), `name` is the component
 * name derived from the filename (`'X'`), matching the canonical declaration's
 * name — the same exception documented on `aliasOf`. Because of that
 * re-keying, two entries in one module can share a `name` (a re-keyed
 * component colliding with a same-name re-export from another module);
 * `(module, name)` pairs remain unique (exact duplicates are deduped at
 * construction).
 *
 * `@nodocs` on the export statement suppresses the entry (and the
 * `alsoExportedFrom` back-link). When the canonical declaration itself is
 * `@nodocs`, the entry still exists but has no matching back-link. `module`
 * is always a module in the same result: a re-export whose canonical module
 * emits nothing (gated, or outside the analyzed inputs) is a declaration with
 * `aliasOf` in the re-exporting module instead, and `aliasOf.module` is the
 * one field that can name a module the result doesn't contain.
 *
 * A star over a module that emits nothing produces entries here too, one per
 * projected binding whose canonical does emit, with the star statement's
 * line and type-only-ness (see `ModuleJson.starExports`).
 */
export const ReExportJson: ReExportJsonSchema = ReExportJsonImpl;
export type ReExportJson = v.InferOutput<typeof ReExportJson>;
export type ReExportJsonInput = v.InferInput<typeof ReExportJson>;

const ExternalReExportJsonImpl = v.strictObject({
	/** Public exported name from this module. */
	name: v.string(),
	/** Module specifier as written in the statement (e.g. `'pkg'`). */
	specifier: v.string(),
	/**
	 * The name inside the external module when renamed
	 * (`export {x as y} from 'pkg'` → `'x'`). Omitted for same-name
	 * re-exports and namespace form (`export * as ns`).
	 */
	originalName: v.optional(v.string()),
	/** Whether the statement or specifier is type-only — see `ReExportJson.typeOnly`. */
	typeOnly: v.optional(v.boolean(), false),
	/** 1-based line of the export specifier in this module's source. */
	sourceLine: v.optional(v.pipe(v.number(), v.finite()))
});
/** @nodocs */
export interface ExternalReExportJsonSchema extends Named<typeof ExternalReExportJsonImpl> {}
/**
 * A re-export whose immediate target is an external package —
 * `export {x} from 'pkg'`, `export {x as y} from 'pkg'`, or
 * `export * as ns from 'pkg'`. External is per `createIsExternalPath`; a
 * project-local target excluded from output (the `internal/` convention) is
 * not external, and its re-exports synthesize alias declarations instead.
 *
 * `specifier` is the module specifier as written (usually a package name);
 * there is no canonical declaration to resolve, so these entries are flat
 * facts about the statement rather than edges into the module graph.
 *
 * Only statements that *directly* reference the external specifier are
 * captured. Forms that stay silent: `import {x} from 'pkg'; export {x};`
 * (import-then-export), re-export chains that reach a package through
 * another source module (that module owns the entry) or through a
 * project-local gated module, and specifiers the checker can't resolve.
 * Statement-level `@nodocs` suppresses the entry.
 */
export const ExternalReExportJson: ExternalReExportJsonSchema = ExternalReExportJsonImpl;
export type ExternalReExportJson = v.InferOutput<typeof ExternalReExportJson>;
export type ExternalReExportJsonInput = v.InferInput<typeof ExternalReExportJson>;

const ModuleJsonImpl = v.strictObject({
	/**
	 * Path relative to `sourceRoot` (e.g., `helpers.ts` for the default
	 * SvelteKit `src/lib` layout). `sourceRoot` is configurable via
	 * `createSourceOptions` / the CLI `--source-root` flag — consumers with a
	 * custom layout (e.g., `sourcePaths: ['src/lib', 'src/routes']`,
	 * `sourceRoot: 'src'`) see prefixes like `lib/foo.ts` here.
	 */
	path: v.string(),
	/** Exported declarations from this module. */
	declarations: v.optional(v.array(DeclarationJson), () => []),
	/**
	 * The prose of the file-level comment, the one carrying a `@module` tag:
	 * its main text, with every tag line removed. Absent when the comment has
	 * no prose (a tag-only comment, or none at all).
	 *
	 * The comment's tags parse as a declaration's do, into the fields below
	 * (`examples`, `deprecatedMessage`, `seeAlso`, `since`, `internalMessage`).
	 * Tags that only describe a declaration (`@param`, `@returns`,
	 * `@mutates`, `@throws`, `@default`, `@nodocs`) are dropped with a
	 * `misplaced_tag` warning, and unknown tags drop silently. For a Svelte
	 * file it comes from the instance `<script>`, the `<script module>`, or an
	 * HTML comment with a `@module` line, the first in that order whose
	 * comment populates any of these fields.
	 */
	moduleComment: v.optional(v.string()),
	...moduleDocFields,
	/** Modules this imports (paths relative to `sourceRoot`). */
	dependencies: v.optional(v.array(v.string()), () => []),
	/** Modules that import this (paths relative to `sourceRoot`). */
	dependents: v.optional(v.array(v.string()), () => []),
	/**
	 * Modules fully re-exported via `export * from './module'`.
	 * Paths are relative to `sourceRoot`. Statement-level `@nodocs`
	 * suppresses the entry, like the other re-export encodings. `export type *
	 * from` is recorded like a value star — per-statement type-only-ness isn't
	 * captured — and each target appears once, however many statements name it.
	 *
	 * Only modules that are themselves in the result appear. A star over a
	 * project module that emits nothing (gated, or outside the analyzed
	 * inputs) has no entry: the bindings it projects are documented in this
	 * module as the named re-exports the star stands for — declarations with
	 * `aliasOf`, or `reExports` entries for bindings whose canonical does
	 * emit — following ES star semantics (`default` doesn't project, a local
	 * export shadows, a name two stars disagree on is excluded). A binding
	 * such a module re-exports from a package is not recorded anywhere.
	 *
	 * A star over a component that failed to transform names its `partial`
	 * placeholder module, whose bindings are unknown (`resolveExportSurface`
	 * reports it unresolved); one that emits nothing (gated, never supplied)
	 * is dropped.
	 */
	starExports: v.optional(v.array(v.string()), () => []),
	/**
	 * Same-name re-exports in this module's source, sorted by `name` then
	 * `module` (names can collide — see `ReExportJson`). The forward view of
	 * `alsoExportedFrom` — see `ReExportJson` for the full contract (canonical
	 * resolution, Svelte default-slot naming, `@nodocs` suppression, presence
	 * caveats).
	 */
	reExports: v.optional(v.array(ReExportJson), () => []),
	/**
	 * Re-exports whose immediate target is an external package, sorted by
	 * `name` then `specifier`. See `ExternalReExportJson` for which forms
	 * are captured.
	 */
	externalReExports: v.optional(v.array(ExternalReExportJson), () => []),
	/**
	 * External modules fully re-exported via `export * from 'pkg'`, as
	 * written (statement order, each specifier once). The projected names are unknown — the
	 * package isn't analyzed. Statement-level `@nodocs` suppresses the
	 * entry; unresolvable specifiers are skipped. A relative `.svelte`
	 * specifier is never an entry, whether or not its component has a
	 * virtual (see `starExports`).
	 */
	externalStarExports: v.optional(v.array(v.string()), () => []),
	/**
	 * Whether the module is a placeholder for a file that couldn't be analyzed.
	 *
	 * Currently only set for Svelte files where svelte2tsx threw at ingest
	 * (the `transform_failed` diagnostic carries the error). Placeholder
	 * modules have `declarations: []` and serve as a structural slot so the
	 * `modules` array reflects the full emitted (source-gated) set; consumers
	 * render them as "broken" entries.
	 */
	partial: v.optional(v.boolean(), false)
});
/** @nodocs */
export interface ModuleJsonSchema extends Named<typeof ModuleJsonImpl> {}
/**
 * Metadata for a source module — the top-level container in the data model.
 *
 * `analyze`, `analyzeFromFiles`, and `AnalysisSession.query` return `AnalyzeResultJson`,
 * whose `modules` is sorted by `path` (`compareStrings`).
 * Each module contains its exported `declarations`, dependency graph, and optional `moduleComment`.
 */
export const ModuleJson: ModuleJsonSchema = ModuleJsonImpl;
export type ModuleJson = v.InferOutput<typeof ModuleJson>;
export type ModuleJsonInput = v.InferInput<typeof ModuleJson>;

/**
 * Validate a `ModuleJson`, restoring the defaults the wire form omits.
 *
 * The stable way to validate a module or restore what `compactReplacer`
 * stripped (empty arrays, `false` booleans), independent of the schema
 * library behind `ModuleJson`.
 *
 * @param value - a module, typically from `JSON.parse` of compact output
 * @returns the validated module with every default present
 * @throws Error when `value` doesn't match the schema; the message lists the
 *   reported issues, one per line, as `path: message` (`declarations.1.kind: Invalid type: …`),
 *   the dot path omitted for an issue at the root. The class is the schema
 *   library's (valibot's `ValiError`, the structured list on `issues`), so catch it
 *   as a plain `Error` unless you depend on valibot
 */
export const parseModuleJson = (value: unknown): ModuleJson => parseWithSummary(ModuleJson, value);
