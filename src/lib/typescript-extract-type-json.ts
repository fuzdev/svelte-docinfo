/**
 * Structured type extraction — builds `TypeJson` trees from checker types.
 *
 * Also the home of the checker-policy primitives the sibling extractors
 * consume: `optionalWideningTarget` (the one owner of the optional-widening
 * strip — `getTypeSignature` and `getNonOptionalType` in
 * `typescript-extract-shared.ts` select through it, so the flat string, the
 * tree, and the structural queries can't drift), `referenceSymbolName` (the
 * named-generic-instantiation predicate, shared with `isSnippetType` in
 * `svelte.ts`), and `tupleElements`/`tupleElementName`/`restElementForms` (the
 * one tuple-element walk, naming rule, and rest-element projection, shared
 * with `extractSnippetParameters`). `resolveTypeInfo` builds the
 * tree and applies the `TypeJson` absence contract — returning `undefined`
 * when the node carries no structure beyond the flat string. It also owns
 * name recovery for types whose alias TypeScript dropped (an alias over an
 * indexed access or conditional — `z.infer<typeof S>`, valibot's
 * `InferOutput`), through two composed channels consulted only at nameless
 * positions: written-name recovery (a caller-supplied annotation node feeds a
 * type-identity map, `buildWrittenNameMap`) and the identity-keyed alias
 * registry (`AliasRegistry`, built by `buildAliasRegistry` in
 * `typescript-alias-registry.ts` over the analyzed set's exported lost
 * aliases). Where either names the type, the tree emits
 * `{kind: 'reference', name}` instead of the structure the checker would
 * print. The written channel wins when both match; the registry is
 * additionally suppressed at the root of a type-alias declaration's own site
 * (the self-skip — a lost alias carries no `aliasSymbol`, so without it the
 * declaration's own `typeInfo` would collapse to a self-reference, or under
 * ambiguity a reference to its twin; nested self-hits stay live and terminate
 * recursive types with a name). The same annotation node orders union
 * members as written (`writtenUnionMemberTypes`), behind an aliased union's
 * own declaration. Expansion, alias, ordering, and normalization policy live
 * on the `TypeJson` schema doc in `types.ts`.
 *
 * svelte2tsx-generated aliases (`$$ComponentProps`,
 * `__sveltets_2_PropsWithChildren`) count as no alias at all, here and in the
 * registry pre-pass — every alias read goes through `linkableAliasSymbol`.
 *
 * @internal Used by the extractors — not part of the public barrel export.
 *
 * @module
 */

import ts from 'typescript';

import { isSvelte2tsxInternal, isSvelteVirtualPath } from './source.ts';
import { isSvelteShimPath } from './typescript-program.ts';
import type { TupleElementJson, TypeJson } from './types.ts';

/**
 * Recursion cap for `TypeJson` trees; nodes at the cap degrade to
 * `{kind: 'other', text}`. Bounds pathological nesting and terminates the one
 * unbounded walk a recursive alias can produce (`type Json = string | Json[]`
 * cycles through union members and array elements).
 */
const MAX_TYPE_JSON_DEPTH = 5;

/**
 * Size budget for a terminal node's `text`, the companion bound to
 * `MAX_TYPE_JSON_DEPTH`. Depth bounds how *far* a tree walks; this bounds how
 * *wide* one node gets — and a terminal node routes around the depth cap
 * entirely, since its whole payload is one string.
 *
 * The budget exists because a type whose alias TypeScript dropped prints its
 * full structure: an alias whose right-hand side is an indexed access or
 * conditional (`z.infer<typeof S>`, valibot's `InferOutput`) carries no
 * `aliasSymbol`, so the checker expands it everywhere. Measured on this repo's
 * own Zod-typed source, 23 such nodes held 60% of all terminal text, one of
 * them 25,699 chars — against a 320-char flat sibling. Nodes under the budget
 * are unaffected, which is the great majority: the band this preserves
 * (160–1000 chars) is what opting out of the checker's ~160-char default was
 * for in the first place.
 */
const MAX_TERMINAL_TEXT = 1000;

/**
 * Terminal `text` fields are load-bearing (the node has no other content), so
 * they opt out of the checker's default ~160-char truncation — up to
 * `MAX_TERMINAL_TEXT`. Past it the checker's own elided rendering is used, so
 * `text` is always a well-formed type string rather than a hand-sliced prefix
 * (the printer offers no middle setting — the flag swaps a 160-char budget for
 * an effectively unlimited one, so the fallback is a step down to 160, not to
 * the budget). The flat type strings keep the default throughout — they are
 * the checker's canonical rendering.
 */
const printType = (type: ts.Type, checker: ts.TypeChecker): string => {
	// a generated alias's default rendering is its dead name, so expand it
	if (hasGeneratedAlias(type)) return printAliasedType(type, checker);
	const full = checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);
	return full.length <= MAX_TERMINAL_TEXT ? full : checker.typeToString(type);
};

/**
 * `printType` for a type standing at its own alias's declaration, where the
 * default rendering is the alias name itself. `InTypeAlias` is the printer flag
 * for exactly this position — it writes what the alias expands to. Budgeted
 * like `printType`; the fallback keeps `InTypeAlias` so an over-budget alias
 * root still expands rather than printing its own name.
 */
const printAliasedType = (type: ts.Type, checker: ts.TypeChecker): string => {
	const full = checker.typeToString(
		type,
		undefined,
		ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias
	);
	return full.length <= MAX_TERMINAL_TEXT
		? full
		: checker.typeToString(type, undefined, ts.TypeFormatFlags.InTypeAlias);
};

/**
 * Whether an alias symbol is one svelte2tsx generated: an
 * `isSvelte2tsxInternal` name declared in a Svelte virtual or in the shims
 * analysis roots (`isSvelteShimPath`).
 *
 * - **In a virtual** — in practice that's `$$ComponentProps`, the alias
 *   svelte2tsx writes for props without a name of their own (an inline
 *   `$props()` annotation, or a JS component's JSDoc), which the component's
 *   type then carries (`Component<$$ComponentProps, {}, "">`). A legacy
 *   component's author-written `type $$Props` counts too: svelte2tsx reads it
 *   by that reserved name, and like the generated alias it's local to the
 *   component and never exported.
 * - **In the shims** — `__sveltets_2_PropsWithChildren`, the props of a legacy
 *   component with slots (`ComponentProps<Legacy>`).
 *
 * Requiring one of those files keeps a project's own `$$`- or
 * `__sveltets_`-named alias in a `.ts` module a name. The shims' unprefixed
 * globals (`Expand`, `KeysMatching`) stay names too: a project can write them.
 */
const isSvelte2tsxGeneratedAlias = (symbol: ts.Symbol): boolean =>
	isSvelte2tsxInternal(symbol.name) &&
	(symbol.declarations?.some((d) => {
		const { fileName } = d.getSourceFile();
		return isSvelteVirtualPath(fileName) || isSvelteShimPath(fileName);
	}) ?? false);

/** Whether a type's alias symbol is svelte2tsx-generated (`isSvelte2tsxGeneratedAlias`). */
const hasGeneratedAlias = (type: ts.Type): boolean =>
	type.aliasSymbol !== undefined && isSvelte2tsxGeneratedAlias(type.aliasSymbol);

/**
 * Whether a flat string prints a generated alias (`hasGeneratedAlias`) bare,
 * or as an array or tuple element at any depth the tree reaches (`$$ComponentProps[]`,
 * `readonly [first: $$ComponentProps]`), where no other node would carry the
 * structure the name hides. Other containers need no help: a union,
 * intersection, or generic reference over the alias already qualifies as
 * structure, and a terminal `text` node prints it nested (see
 * `isSvelte2tsxInternal`). The walk looks through a union only for an optional
 * tuple element, whose type carries the widening `undefined`
 * (`[$$ComponentProps?]`); at a root the union is already structure, so the
 * answer there never matters.
 *
 * The walk stops at a project alias, which prints its own name, so a
 * recursive array or tuple alias (`type R = R[]`) can't recur forever, and at
 * the tree's depth cap, past which there's no structure left to keep.
 */
const printsGeneratedAlias = (type: ts.Type, checker: ts.TypeChecker, depth = 0): boolean => {
	if (hasGeneratedAlias(type)) return true;
	if (type.aliasSymbol !== undefined || depth >= MAX_TYPE_JSON_DEPTH) return false;
	if (type.isUnion()) return type.types.some((t) => printsGeneratedAlias(t, checker, depth + 1));
	return (
		(checker.isArrayType(type) || checker.isTupleType(type)) &&
		checker
			.getTypeArguments(type as ts.TypeReference)
			.some((t) => printsGeneratedAlias(t, checker, depth + 1))
	);
};

/**
 * The alias symbol a type may be named by: `type.aliasSymbol`, except a
 * svelte2tsx-generated one (`isSvelte2tsxGeneratedAlias`), which counts as no
 * alias at all. Every alias read in the tree builder and in name recovery goes
 * through it, so a generated alias is nameless throughout:
 *
 * - it never surfaces as a `reference` name or a union/intersection `alias`,
 *   since nothing exports it and it would be a dead lookup key
 * - it doesn't pre-empt recovery: a project alias over it
 *   (`type P = ComponentProps<typeof Button>`) is alias-lost
 *   (`isAliasLostType`), so it registers, recovers at use sites through
 *   either channel, and warns `alias_lost` when neither can
 * - what nothing recovers prints its structure (`printType` expands the
 *   alias), and a root whose flat string is the generated name keeps that
 *   structure (`resolveTypeInfo`)
 *
 * The flat strings are the checker's rendering and keep the generated name.
 */
export const linkableAliasSymbol = (type: ts.Type): ts.Symbol | undefined =>
	hasGeneratedAlias(type) ? undefined : type.aliasSymbol;

/** Whether the type is `null` or a union with a `null` member. */
const hasNullMember = (type: ts.Type): boolean =>
	type.isUnion()
		? type.types.some((t) => !!(t.flags & ts.TypeFlags.Null))
		: !!(type.flags & ts.TypeFlags.Null);

/**
 * The single owner of the optional-widening strip, shared with
 * `getTypeSignature` and `getNonOptionalType` (in
 * `typescript-extract-shared.ts`) so the flat string, the tree, and the
 * structural queries can't drift. Owns the `optional` gate too — a
 * non-`optional` position passes through, so call sites hand over the flag
 * rather than branching around the call. For a type at an `optional`-flagged
 * position (a `?`-marked declaration or tuple element):
 *
 * - a non-union carries no separate widening member to strip, so it passes
 *   through. Three shapes land here: `x?: undefined` (the written type and the
 *   widening coincide), and `x?: unknown` / `x?: any` (both absorb
 *   `undefined`). `getNonNullableType` must not run on any of them — it
 *   answers `{}` for `unknown`, which would report `x?: unknown` as `"{}"`
 * - a `null`-bearing union keeps its shape and reports `dropUndefined` — the
 *   walk drops only the widening member (so the alias survives) and the
 *   printer trims the printed suffix
 * - a union left with exactly one member after dropping `undefined` takes that
 *   member directly — it *is* the annotated type. Matters for a bare
 *   unconstrained type parameter (`c?: E`), where `getNonNullableType` can
 *   only answer `NonNullable<E>`
 * - every other union takes `getNonNullableType`, which rebuilds the union
 *   rather than picking a member (so a union of callables keeps its combined
 *   call signature) and preserves the alias symbol
 *
 * Under `exactOptionalPropertyTypes` the checker widens optional *properties*
 * not at all, so property sites gate `optional` off via `optionalWidened`
 * (in `typescript-extract-shared.ts`) and never reach the strip; optional
 * parameters and tuple elements widen under both modes and keep passing
 * `optional` unconditionally.
 */
export const optionalWideningTarget = (
	type: ts.Type,
	checker: ts.TypeChecker,
	optional: boolean
): { target: ts.Type; dropUndefined: boolean } => {
	if (!optional || !type.isUnion()) return { target: type, dropUndefined: false };
	if (hasNullMember(type)) return { target: type, dropUndefined: true };
	const nonUndefined = type.types.filter((t) => !(t.flags & ts.TypeFlags.Undefined));
	if (nonUndefined.length === 1) return { target: nonUndefined[0]!, dropUndefined: false };
	return { target: checker.getNonNullableType(type), dropUndefined: false };
};

/**
 * The type's non-anonymous symbol name (`__type`/`__object`/`__function` mark
 * anonymous shapes). The one anonymity rule shared by the recovery gate here,
 * the alias-lost predicate (`isAliasLostType`), and the registry's safety-gate
 * walk (`typescript-alias-registry.ts`) — never `ObjectFlags.Anonymous`, which
 * real inferred schema outputs (zod's are `Mapped | Instantiated`) don't carry.
 */
export const namedSymbolName = (type: ts.Type): string | undefined => {
	const name = type.symbol?.name;
	return name && !name.startsWith('__') ? name : undefined;
};

/**
 * Whether a type is a module object — `typeof import("./dep.ts")`, from an
 * `import()` expression or `typeof` over a namespace import. Mirrors the
 * checker's own external-module test: the `ValueModule` flag plus a quoted
 * symbol name (a source file's symbol is named by its quoted specifier; a
 * `namespace Foo {}` symbol carries the flag with a plain name and stays out).
 */
const isModuleObjectType = (type: ts.Type): boolean => {
	const symbol: ts.Symbol | undefined = type.symbol;
	return (
		symbol !== undefined &&
		(symbol.flags & ts.SymbolFlags.ValueModule) !== 0 &&
		symbol.name.startsWith('"')
	);
};

/**
 * Whether the checker kept no name for a type-alias declaration's resolved
 * type: no alias symbol (the checker still prints `type A = B` as `B`), no
 * nominal symbol (interfaces/classes/enums print their own name), and not an
 * interned terminal (`type A = string` and `type A = 'x'` carry no alias
 * symbol either but print fine). True for the expansion-prone class the alias
 * registry targets and the `alias_lost` diagnostic reports —
 * indexed-access and conditional right-hand sides (`z.infer<typeof S>` et
 * al.), whose resolution lands on a pre-existing interned type that TypeScript
 * never retroactively stamps an alias symbol on.
 *
 * An alias whose only alias symbol is svelte2tsx-generated counts as lost
 * (`linkableAliasSymbol`): `type P = ComponentProps<typeof Button>` over inline
 * props prints as `$$ComponentProps`, a name no consumer can look up.
 *
 * The exception is a lost alias over an array root: `namedSymbolName` names it
 * `Array`, so the predicate is false and it never registers.
 */
export const isAliasLostType = (type: ts.Type): boolean =>
	linkableAliasSymbol(type) === undefined &&
	namedSymbolName(type) === undefined &&
	!(type.flags & (INTRINSIC_FLAGS | ts.TypeFlags.Literal));

/**
 * Whether a type is a union of literals only (`z.enum` outputs — a lost alias
 * over one degrades mildly and readably, so the `alias_lost` diagnostic
 * excludes it). Enum-member literals match too.
 */
export const isLiteralOnlyUnion = (type: ts.Type): boolean =>
	type.isUnion() && type.types.every((t) => !!(t.flags & ts.TypeFlags.Literal));

/**
 * Whether a type is an intersection carrying an intrinsic or literal member —
 * the `.brand()` shape (`string & BRAND<'x'>`). Such aliases are lost but
 * unrecoverable, readable, and author-unfixable, so the `alias_lost`
 * diagnostic excludes them.
 */
export const isBrandLikeIntersection = (type: ts.Type): boolean =>
	type.isIntersection() &&
	type.types.some((t) => !!(t.flags & (INTRINSIC_FLAGS | ts.TypeFlags.Literal)));

/** A name registered for an alias-lost type — see `buildAliasRegistry` in `typescript-alias-registry.ts`. */
export interface AliasRegistryEntry {
	/** The alias's importable name. */
	name: string;
	/** The `ModuleJson.path` of the module declaring the alias. */
	module: string;
}

/**
 * Identity-keyed registry of exported alias-lost type aliases, consulted by
 * the tree builder at nameless positions behind written-name recovery. Built
 * per analysis cycle by `buildAliasRegistry` (`typescript-alias-registry.ts`);
 * `undefined` wherever no pre-pass ran (registry recovery disabled, written
 * recovery unaffected).
 *
 * Registry hits must be linkable: identity-exact matches against aliases the
 * output documents. That's why `@nodocs` aliases and aliases in gated modules
 * (`internal/`) never register, and why package aliases never do ("never name
 * what the project didn't declare").
 */
export interface AliasRegistry {
	/** Checker type identity → the winning alias (`compareStrings` name-then-module tie-break). */
	byType: Map<ts.Type, AliasRegistryEntry>;
	/**
	 * Union member-set key (`unionMemberSetKey`) → the winning alias, for
	 * registered unions only. Consulted at optional-widened positions, where a
	 * `null`-bearing union flattens with the widening `undefined` into a type
	 * object the identity lookup can never match — the registered members
	 * survive by identity inside the widened union, so the set matches exactly.
	 */
	byMemberSet: Map<string, AliasRegistryEntry>;
	/**
	 * Alias declarations the `alias_lost` warning has fired for this cycle.
	 * Re-export synthesis re-analyzes canonical declarations
	 * (`synthesizeCrossFileAlias`, within-file renames), so one declaration can
	 * reach `warnAliasLost` from several analyzing sites in a cycle — this set
	 * dedupes to one warning per declaration. It rides on the registry because
	 * the registry is the one cycle-scoped object every warn site already holds
	 * (the warning is gated on a registry being in hand).
	 */
	warnedAliasLost: Set<ts.TypeAliasDeclaration>;
}

/** `ts.Type` with the internal `id` field (absent from the public declarations). */
interface TypeWithId extends ts.Type {
	id?: number;
}

/**
 * The member-set key of a union — sorted internal type ids, `undefined`
 * filtered — or `undefined` when unusable (an internal-API `id` missing, or
 * fewer than two non-`undefined` members, a set no widened-union lookup can
 * produce). One function for both sides so registration and lookup can't
 * drift. Identity safety carries over from the ids: two unions share a key
 * only when they share their non-`undefined` members by object identity.
 */
export const unionMemberSetKey = (type: ts.UnionType): string | undefined => {
	const ids: Array<number> = [];
	for (const t of type.types) {
		if (t.flags & ts.TypeFlags.Undefined) continue;
		const id = (t as TypeWithId).id;
		if (typeof id !== 'number') return undefined;
		ids.push(id);
	}
	if (ids.length < 2) return undefined;
	ids.sort((a, b) => a - b);
	return ids.join(',');
};

/**
 * Lookup from checker type identity to the name the written annotation used
 * for it — the recovery channel for aliases TypeScript dropped. Produced by
 * `createWrittenNameLookup`; `undefined` at call sites with no written
 * annotation to read.
 */
type WrittenNameLookup = (type: ts.Type) => string | undefined;

/**
 * The name a module exports an aliased symbol under, or `undefined` when the
 * alias names no export (a default or namespace import, a star re-export).
 *
 * The one rule shared by both name-recovery channels — this file's written-name
 * lookup and `externalTypeRefText`'s textual substitution
 * (`typescript-extract-shared.ts`). Both specifier kinds carry the name, on
 * opposite sides of their own `as`: an `ImportSpecifier` takes the module's
 * side, its `propertyName` (`import type {Bag as B}` → `Bag`, `B` being this
 * file's private spelling), while an `ExportSpecifier` *is* the module's side,
 * so its `name` is what it publishes (`export {Internal as Public}` → `Public`,
 * `Internal` being the other module's). Unrenamed, both collapse to the one
 * name written.
 *
 * Stopping at a specifier rather than resolving the whole alias chain is what
 * makes the result importable: the chain ends at the *declaration's* name,
 * which a module renaming on the way out never exports — recovering `Internal`
 * there names something no consumer of that module can reach.
 */
export const specifierExportedName = (symbol: ts.Symbol): string | undefined => {
	if (!(symbol.flags & ts.SymbolFlags.Alias)) return undefined;
	const decls = symbol.getDeclarations();
	if (!decls) return undefined;
	// an import binding is the nearer hop when a symbol carries both, and the
	// only one whose local spelling can differ from what it names
	const imported = decls.find(ts.isImportSpecifier);
	if (imported) return (imported.propertyName ?? imported.name).text;
	return decls.find(ts.isExportSpecifier)?.name.text;
};

/**
 * The importable name a written type reference resolves to — through import
 * aliases (`import {Original as Renamed}` yields `Original`), so the recovered
 * name is the one a consumer can look up, not a file-local spelling.
 *
 * A specifier stops the walk at the name its module exports
 * (`specifierExportedName`), whether the reference reaches it through an import
 * binding or namespace-qualified through the re-export itself. Only an alias
 * naming no export — a default or namespace import — falls through to the whole
 * chain, where the declaration's own name is the only name there is.
 */
const referenceNodeName = (
	node: ts.TypeReferenceNode,
	checker: ts.TypeChecker
): string | undefined => {
	const symbol = checker.getSymbolAtLocation(node.typeName);
	if (!symbol) return undefined;
	const exported = specifierExportedName(symbol);
	if (exported !== undefined) return exported;
	return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol).name : symbol.name;
};

/**
 * Map each bare type reference in a written annotation to its resolved name,
 * keyed by checker type identity. Identity holds at arbitrary depth and is
 * order-independent, so no positional correspondence between written and
 * checker type arguments is needed — the union walk reorders members and the
 * checker collapses `Array<X>` to `X[]` without breaking the lookup.
 *
 * Only argument-less `TypeReferenceNode`s enter the map: `typeof x`
 * (`TypeQueryNode`), `import('…').X` (`ImportTypeNode`), and inline type
 * literals are excluded by node kind, and a written instantiation
 * (`z.infer<typeof S>`, `Extract<D, …>`) is excluded because its bare symbol
 * name misrepresents it — dropping the arguments would emit
 * `{kind: 'reference', name: 'infer'}`. A reference resolving to a type
 * parameter is excluded (a written `T` names nothing recoverable), as is one
 * resolving to an interned type — intrinsics and literals are shared
 * program-wide, so a name for one would claim every unrelated occurrence in
 * the tree, and their canonical rendering is already the simplest truth
 * (`type A = Box['s']` over a `string` property stays `string`). The
 * first-written name wins when two references resolve to one type.
 */
const buildWrittenNameMap = (node: ts.TypeNode, checker: ts.TypeChecker): Map<ts.Type, string> => {
	const map = new Map<ts.Type, string>();
	const excluded = INTRINSIC_FLAGS | ts.TypeFlags.Literal | ts.TypeFlags.TypeParameter;
	const walk = (n: ts.Node): void => {
		if (ts.isTypeReferenceNode(n) && !n.typeArguments?.length) {
			try {
				const type = checker.getTypeFromTypeNode(n);
				if (!(type.flags & excluded) && !map.has(type)) {
					const name = referenceNodeName(n, checker);
					// a written generated alias (svelte2tsx's own annotations) names nothing
					const generated = hasGeneratedAlias(type) && name === type.aliasSymbol?.name;
					if (name !== undefined && !generated) map.set(type, name);
				}
			} catch {
				// a malformed or unresolved annotation contributes no entry
			}
		}
		// the callback must return undefined — `ts.forEachChild` short-circuits
		// on a truthy return and would silently visit only the first child
		ts.forEachChild(n, walk);
	};
	walk(node);
	return map;
};

/**
 * A `WrittenNameLookup` over an annotation node, or `undefined` without one.
 * The map builds lazily on first lookup — most trees never reach a nameless
 * node (or are absent entirely), so most annotations are never walked.
 */
const createWrittenNameLookup = (
	node: ts.TypeNode | undefined,
	checker: ts.TypeChecker
): WrittenNameLookup | undefined => {
	if (!node) return undefined;
	let map: Map<ts.Type, string> | undefined;
	return (type) => (map ??= buildWrittenNameMap(node, checker)).get(type);
};

/** Unwrap any parentheses around a written type node (`('a' | 'b')`). */
const unwrapParenthesizedType = (node: ts.TypeNode): ts.TypeNode => {
	let inner = node;
	while (ts.isParenthesizedTypeNode(inner)) inner = inner.type;
	return inner;
};

/**
 * Lookup from a checker union to the written union node it was built from at
 * this site — the source of written member order (`writtenUnionMemberTypes`).
 * Produced by `createWrittenUnionLookup`; `undefined` at call sites with no
 * written annotation to read.
 */
type WrittenUnionLookup = (type: ts.UnionType) => ts.UnionTypeNode | undefined;

/**
 * Map each outermost union node in a written annotation to its member-set key
 * (`unionMemberSetKey`). Outermost because a union nested directly in a union
 * is flattened into it by the checker (parentheses don't count as nesting), so
 * only the outer node has a checker union of its own; a union under another
 * kind of node (`M<'a' | 'b'>`, `['a' | 'b']`) is outermost in its own right.
 *
 * Keyed by member set rather than identity so the lookup survives the
 * rebuilds between the written node and the type the tree walks: the
 * optional-widening `undefined` (filtered from the key) and
 * `getNonNullableType`, which builds a new union over the same members. The
 * cost is that two written unions over one member set share the first one
 * written, so a later one in another order takes the first one's order.
 */
const buildWrittenUnionMap = (
	node: ts.TypeNode,
	checker: ts.TypeChecker
): Map<string, ts.UnionTypeNode> => {
	const map = new Map<string, ts.UnionTypeNode>();
	const walk = (n: ts.Node): void => {
		if (ts.isUnionTypeNode(n) && !isNestedInUnion(n)) {
			try {
				const type = checker.getTypeFromTypeNode(n);
				const key = type.isUnion() ? unionMemberSetKey(type) : undefined;
				if (key !== undefined && !map.has(key)) map.set(key, n);
			} catch {
				// a malformed or unresolved annotation contributes no entry
			}
		}
		// the callback must return undefined — see `buildWrittenNameMap`
		ts.forEachChild(n, walk);
	};
	walk(node);
	return map;
};

/** Whether a union node sits directly in another union, parentheses aside. */
const isNestedInUnion = (node: ts.UnionTypeNode): boolean => {
	let parent = node.parent;
	while (parent !== undefined && ts.isParenthesizedTypeNode(parent)) parent = parent.parent;
	return parent !== undefined && ts.isUnionTypeNode(parent);
};

/**
 * A `WrittenUnionLookup` over an annotation node, or `undefined` without one.
 * Lazy like `createWrittenNameLookup`: the map builds on the first union the
 * tree meets.
 */
const createWrittenUnionLookup = (
	node: ts.TypeNode | undefined,
	checker: ts.TypeChecker
): WrittenUnionLookup | undefined => {
	if (!node) return undefined;
	let map: Map<string, ts.UnionTypeNode> | undefined;
	return (type) => {
		const key = unionMemberSetKey(type);
		return key === undefined ? undefined : (map ??= buildWrittenUnionMap(node, checker)).get(key);
	};
};

/**
 * What a tree build reads off the written annotation at its site — the two
 * name-recovery channels plus the self-skip flag, and the written unions that
 * order union members. Constructed once per
 * `resolveTypeInfo`/`restElementForms` call.
 */
interface NameRecovery {
	/** Names from the written annotation at this site, when one exists. */
	written: WrittenNameLookup | undefined;
	/** Written union nodes from the annotation at this site, when one exists. */
	writtenUnions: WrittenUnionLookup | undefined;
	/** Names from the analyzed set's exported lost aliases, when a pre-pass ran. */
	registry: AliasRegistry | undefined;
	/**
	 * Suppress registry hits for the root node — set at a type-alias
	 * declaration's own site, where a lost declared type is (or ties with) its
	 * own registry entry and a hit would collapse the declaration's structural
	 * tree to a self- or twin-reference. Root-only by position, not identity:
	 * nested self-hits stay live so a recursive lost type terminates with a
	 * name instead of elided text.
	 */
	suppressRegistryAtRoot: boolean;
}

/** The one `NameRecovery` constructor — see the interface for field semantics. */
const createNameRecovery = (
	writtenNode: ts.TypeNode | undefined,
	checker: ts.TypeChecker,
	registry: AliasRegistry | undefined,
	suppressRegistryAtRoot = false
): NameRecovery => ({
	written: createWrittenNameLookup(writtenNode, checker),
	writtenUnions: createWrittenUnionLookup(writtenNode, checker),
	registry,
	suppressRegistryAtRoot
});

/**
 * The reference node recovered for a type the checker has no name for, or
 * `undefined`. Fires only at nameless positions — a type carrying an alias
 * symbol or a non-anonymous symbol is the checker's to name (never
 * overridden), and recovery substitutes the whole node rather than grafting a
 * recovered name onto checker structure: where the checker dropped the alias
 * it expands the structure into the flat string anyway, so the tree's
 * contribution is the name the string lost.
 *
 * Channel order: written annotation first (the author's spelling at this
 * site), then the alias registry by type identity, then — only at
 * optional-widened union positions (`memberSetEligible`, the sibling of
 * `dropUndefined`) — the registry's member-set side index, which is what
 * recovers a `null`-bearing lost union that the widening flattened past
 * identity match.
 *
 * Registry hits carry `module` — the winning entry's declaring
 * `ModuleJson.path`, always an emitted module since gated modules never
 * register — so renderers can link collision-exactly. Written hits
 * deliberately don't: the written name is whatever the author spelled at this
 * site (possibly not the registry's winner), and resolving its module would
 * need source-options threading the written channel doesn't have.
 */
const recoveredReference = (
	type: ts.Type,
	recovery: NameRecovery,
	depth: number,
	memberSetEligible = false
): TypeJson | undefined => {
	if (recovery.written === undefined && recovery.registry === undefined) return undefined;
	if (linkableAliasSymbol(type) !== undefined || namedSymbolName(type) !== undefined) {
		return undefined;
	}
	const written = recovery.written?.(type);
	if (written !== undefined) return { kind: 'reference', name: written };
	const { registry } = recovery;
	if (registry === undefined) return undefined;
	if (depth === 0 && recovery.suppressRegistryAtRoot) return undefined;
	let entry = registry.byType.get(type);
	if (entry === undefined && memberSetEligible && type.isUnion()) {
		const key = unionMemberSetKey(type);
		if (key !== undefined) entry = registry.byMemberSet.get(key);
	}
	if (entry === undefined) return undefined;
	return { kind: 'reference', name: entry.name, module: entry.module };
};

/**
 * The symbol name of a named generic instantiation (`Snippet<[a: string]>`,
 * `Map<string, B>`) — checker `Reference`-flagged, non-anonymous symbol,
 * carrying type arguments — or `undefined` for everything else. One predicate
 * for the two decisions that must agree: the callable-classification
 * exception (such a type is a `reference` node even when it has call
 * signatures) and the object branch's reference emission. Tuples never match
 * (their references carry no symbol); bare and aliased signatures are
 * `Anonymous`-flagged; non-generic callable interfaces either aren't
 * `Reference`-flagged (thisless) or carry no type arguments (the declared
 * type of a `this`-referencing interface or a class is its own `Reference`
 * with an empty argument list) — all of these stay `function` nodes.
 */
export const referenceSymbolName = (type: ts.Type, checker: ts.TypeChecker): string | undefined => {
	if (!(type.flags & ts.TypeFlags.Object)) return undefined;
	if (!((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference)) return undefined;
	const name = namedSymbolName(type);
	if (name === undefined) return undefined;
	return checker.getTypeArguments(type as ts.TypeReference).length > 0 ? name : undefined;
};

/**
 * Type flags rendered as a terminal `{kind: 'intrinsic'}` node. `Boolean` is
 * included so the check runs before the union branch — the `boolean` type is
 * itself a union (`true | false`) and would otherwise expand.
 */
const INTRINSIC_FLAGS =
	ts.TypeFlags.Any |
	ts.TypeFlags.Unknown |
	ts.TypeFlags.String |
	ts.TypeFlags.Number |
	ts.TypeFlags.BigInt |
	ts.TypeFlags.Boolean |
	ts.TypeFlags.ESSymbol |
	ts.TypeFlags.UniqueESSymbol |
	ts.TypeFlags.Void |
	ts.TypeFlags.Undefined |
	ts.TypeFlags.Null |
	ts.TypeFlags.Never |
	ts.TypeFlags.NonPrimitive;

/** The `{value, text}` node for a literal type, or `undefined` when not a literal. */
const literalNode = (type: ts.Type, checker: ts.TypeChecker): TypeJson | undefined => {
	// string/number literals cover enum members too — an enum member is a literal
	// with the EnumLiteral flag, and `typeToString` prints its qualified name
	// (`MyEnum.FOO`) while `value` stays the runtime value
	if (type.isStringLiteral() || type.isNumberLiteral()) {
		return { kind: 'literal', value: type.value, text: printType(type, checker) };
	}
	if (type.flags & ts.TypeFlags.BooleanLiteral) {
		const text = printType(type, checker);
		return { kind: 'literal', value: text === 'true', text };
	}
	if (type.flags & ts.TypeFlags.BigIntLiteral) {
		// pseudo-bigint has no JSON-representable value; the printed text carries both roles
		const text = printType(type, checker);
		return { kind: 'literal', value: text, text };
	}
	return undefined;
};

/** Alias name for a union node — the alias symbol, or the enum symbol for enum-member unions. */
const unionAlias = (type: ts.Type): string | undefined =>
	linkableAliasSymbol(type)?.name ??
	(type.flags & ts.TypeFlags.EnumLiteral ? type.symbol?.name : undefined);

/** `ts.UnionType` with the internal `origin` field the printer reads (absent from the public declarations). */
interface UnionTypeWithOrigin extends ts.UnionType {
	origin?: ts.Type;
}

/** Recursively expand nested unions, mirroring the checker's flattening. */
const flattenUnionMembers = (types: ReadonlyArray<ts.Type>, out: Array<ts.Type>): void => {
	for (const t of types) {
		if (t.isUnion()) flattenUnionMembers(t.types, out);
		else out.push(t);
	}
};

/**
 * A union's members in the checker's order, with its grouping kept — the
 * *slots* `writtenUnionMemberTypes` reorders, and the order the tree falls
 * back to. `ts.UnionType.types` is the checker's normalized list: flattened
 * and sorted by internal type id, which is type-creation order, so it follows
 * no written order (`'a' | 'b' | null` normalizes to `null, "a", "b"`) and can
 * shift with what was created first elsewhere in the program. The union's
 * `origin` — the denormalized union the flat strings are printed from — keeps
 * the grouping but not the written order: its entries are sorted by type id
 * too, so a member written as a named sub-union survives as its own
 * alias-carrying entry (`E | null` keeps `E` instead of flattening to enum
 * literals), wherever its id lands it (`Size | 'x'` and `'x' | Size` both
 * print in one order).
 *
 * `origin` is internal API, so the access is typed locally and validated
 * before use: flattening the origin's nested unions must reproduce the
 * normalized list exactly (same length, same member identities), else fall
 * back to the normalized list. The check guards API drift and any
 * normalization `origin` doesn't mirror (e.g. subtype reduction —
 * `'a' | string` normalizes to `string`, and the walk must not resurrect the
 * dropped literal).
 */
const unionMemberTypes = (type: ts.UnionType): ReadonlyArray<ts.Type> => {
	const origin = (type as UnionTypeWithOrigin).origin;
	if (!origin?.isUnion()) return type.types;
	const flattened: Array<ts.Type> = [];
	flattenUnionMembers(origin.types, flattened);
	if (flattened.length !== type.types.length) return type.types;
	const normalized = new Set<ts.Type>(type.types);
	if (!flattened.every((t) => normalized.has(t))) return type.types;
	return origin.types;
};

/**
 * The written union node an aliased union was declared with: the alias
 * declaration's right-hand side, for a non-generic alias whose right-hand side
 * is a union. A generic alias declines — its declaration's members are written
 * over the type parameters, not the instantiation's arguments. An alias local
 * to a generic scope passes this gate (no type arguments of its own) but
 * writes the outer type parameters; `orderByWrittenUnion`'s validation
 * rejects it.
 */
const aliasUnionNode = (type: ts.Type): ts.UnionTypeNode | undefined => {
	const alias = type.aliasSymbol;
	if (alias === undefined || type.aliasTypeArguments?.length) return undefined;
	const declaration = alias.declarations?.find(ts.isTypeAliasDeclaration);
	if (declaration === undefined || declaration.typeParameters?.length) return undefined;
	const rhs = unwrapParenthesizedType(declaration.type);
	return ts.isUnionTypeNode(rhs) ? rhs : undefined;
};

/**
 * Reorder `slots` (`unionMemberTypes`) by a written union node, or
 * `undefined` when the written node doesn't account for every slot.
 *
 * Each slot is a leaf member or a named sub-union the checker kept whole, and
 * every leaf maps to the slot that holds it. The walk visits the written
 * members in order and places a member's slot at its first appearance, so a
 * duplicate written member places once. A written member that isn't its own
 * slot — a sub-union the checker flattened, like `boolean` or an alias the
 * slots lost — places its leaves in its own written order (its alias
 * declaration's, recursively), then any leaves left in the checker's order. A
 * written member matching no slot (one subtype reduction absorbed, like `'a'`
 * beside `string`, or `never`) is skipped.
 *
 * Validation: every slot except `undefined` must be placed, else the caller
 * falls back to the checker's order. An unplaced `undefined` is the optional
 * widening, which no written node carries; it appends, and
 * `sinkNullishLast` moves it to the end anyway.
 */
const orderByWrittenUnion = (
	unionNode: ts.UnionTypeNode,
	slots: ReadonlyArray<ts.Type>,
	checker: ts.TypeChecker
): ReadonlyArray<ts.Type> | undefined => {
	const slotOf = new Map<ts.Type, ts.Type>();
	for (const slot of slots) {
		slotOf.set(slot, slot);
		if (slot.isUnion()) {
			const leaves: Array<ts.Type> = [];
			flattenUnionMembers(slot.types, leaves);
			for (const leaf of leaves) slotOf.set(leaf, slot);
		}
	}
	const ordered: Array<ts.Type> = [];
	const placed = new Set<ts.Type>();
	const place = (type: ts.Type): boolean => {
		const slot = slotOf.get(type);
		if (slot === undefined) return false;
		if (!placed.has(slot)) {
			placed.add(slot);
			ordered.push(slot);
		}
		return true;
	};
	// guards a recursive alias against revisiting its own declaration
	const visitedAliasNodes = new Set<ts.UnionTypeNode>();
	const visit = (written: ts.TypeNode): void => {
		const node = unwrapParenthesizedType(written);
		if (ts.isUnionTypeNode(node)) {
			for (const member of node.types) visit(member);
			return;
		}
		let type: ts.Type;
		try {
			type = checker.getTypeFromTypeNode(node);
		} catch {
			return;
		}
		if (place(type) || !type.isUnion()) return;
		const aliasNode = aliasUnionNode(type);
		if (aliasNode !== undefined && !visitedAliasNodes.has(aliasNode)) {
			visitedAliasNodes.add(aliasNode);
			visit(aliasNode);
		}
		const leaves: Array<ts.Type> = [];
		flattenUnionMembers(sinkNullishLast(unionMemberTypes(type)), leaves);
		for (const leaf of leaves) place(leaf);
	};
	visit(unionNode);
	for (const slot of slots) {
		if (placed.has(slot)) continue;
		if (!(slot.flags & ts.TypeFlags.Undefined)) return undefined;
		ordered.push(slot);
	}
	return ordered;
};

/**
 * A union's members in written order, or `undefined` when no written union
 * node is recoverable (or none accounts for every member), leaving the
 * checker's order. Two sources, in precedence order:
 *
 * 1. the alias declaration's right-hand side, for a non-generic aliased union
 *    (`aliasUnionNode`) — the author's order for that union at every use,
 *    inferred positions included
 * 2. the union written in the annotation at this site (`WrittenUnionLookup`),
 *    matched by member set
 *
 * A source that fails validation (`orderByWrittenUnion`) falls through to the
 * next.
 */
const writtenUnionMemberTypes = (
	type: ts.UnionType,
	checker: ts.TypeChecker,
	recovery: NameRecovery
): ReadonlyArray<ts.Type> | undefined => {
	const aliasNode = aliasUnionNode(type);
	if (aliasNode !== undefined) {
		const ordered = orderByWrittenUnion(aliasNode, unionMemberTypes(type), checker);
		if (ordered !== undefined) return ordered;
	}
	// consulted only past the alias source, so the site map stays unbuilt
	// wherever aliases answer
	const siteNode = recovery.writtenUnions?.(type);
	return siteNode && orderByWrittenUnion(siteNode, unionMemberTypes(type), checker);
};

/**
 * Sink `null` then `undefined` to the end, everything else keeping its list
 * order — the printer's convention for whatever list it prints from (a written
 * `null | string` prints as `"string | null"`, and `origin` stores nullish
 * members *first*), applied to the tree's order too, written or not.
 */
const sinkNullishLast = (types: ReadonlyArray<ts.Type>): ReadonlyArray<ts.Type> => {
	const rest: Array<ts.Type> = [];
	const nulls: Array<ts.Type> = [];
	const undefineds: Array<ts.Type> = [];
	for (const t of types) {
		if (t.flags & ts.TypeFlags.Undefined) undefineds.push(t);
		else if (t.flags & ts.TypeFlags.Null) nulls.push(t);
		else rest.push(t);
	}
	if (nulls.length === 0 && undefineds.length === 0) return types;
	return rest.concat(nulls, undefineds);
};

/**
 * Positional build options. `dropUndefined` applies wherever the tree meets a
 * sibling `optional` flag — the root call and tuple elements; `skipAliasName`
 * is root-only. Recursive calls otherwise never pass options.
 */
interface BuildTypeJsonOptions {
	/** Filter the optional-widening `undefined` member from the union at an `optional`-flagged position. */
	dropUndefined?: boolean;
	/**
	 * The declaration's own name at a type-alias declaration site — the object
	 * branch skips alias-first referencing for it, so `type A = Map<string, B>`
	 * surfaces the `Map` structure instead of a self-reference (which the
	 * absence contract would drop). Union/intersection nodes keep the alias
	 * regardless: there it labels the members, not a substitute for them.
	 */
	skipAliasName?: string;
}

const NO_OPTIONS: BuildTypeJsonOptions = {};

const buildUnion = (
	type: ts.UnionType,
	checker: ts.TypeChecker,
	depth: number,
	dropUndefined: boolean,
	recovery: NameRecovery
): TypeJson => {
	let memberTypes: ReadonlyArray<ts.Type> = sinkNullishLast(
		writtenUnionMemberTypes(type, checker, recovery) ?? unionMemberTypes(type)
	);
	if (dropUndefined) {
		memberTypes = memberTypes.filter((t) => !(t.flags & ts.TypeFlags.Undefined));
	}

	// Collapse the checker's boolean expansion (`true | false`) back to `boolean`,
	// at the position of the first literal. Without this an optional `boolean`
	// prop would surface as a `'true' | 'false'` literal union after the
	// widening strip. A lone boolean literal stays a literal. Neither slot list
	// keeps `boolean` whole (it isn't a named union, so even an `origin` lists
	// `false` and `true` as separate entries); a written `boolean` places both
	// literals together, so the collapse lands at its written position.
	const booleanLiterals = memberTypes.filter((t) => !!(t.flags & ts.TypeFlags.BooleanLiteral));
	const collapseBoolean = booleanLiterals.length >= 2;

	const members: Array<TypeJson> = [];
	let booleanEmitted = false;
	for (const memberType of memberTypes) {
		if (collapseBoolean && memberType.flags & ts.TypeFlags.BooleanLiteral) {
			if (!booleanEmitted) {
				members.push({ kind: 'intrinsic', text: 'boolean' });
				booleanEmitted = true;
			}
			continue;
		}
		members.push(buildTypeJson(memberType, checker, depth + 1, recovery));
	}

	if (members.length === 0) return { kind: 'other', text: printType(type, checker) };
	if (members.length === 1) return members[0]!;

	const alias = unionAlias(type);
	return alias === undefined ? { kind: 'union', members } : { kind: 'union', alias, members };
};

/** Per-element checker metadata from `tupleElements` — one walk, projected per consumer. */
export interface TupleTypeElement {
	/** The element's type argument; widened with `undefined` when `optional`. */
	type: ts.Type;
	/** The written label declaration, when the tuple has one for this slot. */
	label: ts.NamedTupleMember | ts.ParameterDeclaration | undefined;
	/** Whether the element carries a `?` marker. */
	optional: boolean;
	/** Whether the element is a rest element (`...boolean[]`; `type` is the array *element* type). */
	rest: boolean;
	/** Whether the element is an unresolved variadic spread (`...T`; `type` is the spread type). */
	variadic: boolean;
}

/**
 * The per-index element metadata of a tuple reference — the one place the
 * `typeArguments`/`elementFlags`/`labeledElementDeclarations` triple is read,
 * consumed by `buildTuple` here and `extractSnippetParameters` in `svelte.ts`.
 */
export const tupleElements = (
	type: ts.TypeReference,
	checker: ts.TypeChecker
): Array<TupleTypeElement> => {
	const target = type.target as ts.TupleType;
	return checker.getTypeArguments(type).map((elementType, i) => {
		const flags = target.elementFlags[i]!;
		return {
			type: elementType,
			label: target.labeledElementDeclarations?.[i],
			optional: !!(flags & ts.ElementFlags.Optional),
			rest: !!(flags & ts.ElementFlags.Rest),
			variadic: !!(flags & ts.ElementFlags.Variadic)
		};
	});
};

/**
 * The written element label as an output name: a `NamedTupleMember`'s
 * identifier, or a parameter-derived label's (`Parameters<F>` tuples) — the
 * identifier guard is defensive, since binding-pattern parameters produce no
 * label declaration at all. The one naming rule for both `tupleElements`
 * consumers, so `parameters` and the `typeInfo` tree can't disagree on names.
 */
export const tupleElementName = (el: TupleTypeElement): string | undefined =>
	el.label && ts.isIdentifier(el.label.name) ? el.label.name.text : undefined;

/** `ts.TypeChecker` with the internal `createArrayType` factory (absent from the public declarations). */
interface CheckerWithCreateArrayType extends ts.TypeChecker {
	createArrayType?(elementType: ts.Type): ts.Type;
}

/** The printed array form of a rest element's type — see `restElementForms`. */
const printRestElementType = (elementType: ts.Type, checker: ts.TypeChecker): string => {
	const { createArrayType } = checker as CheckerWithCreateArrayType;
	if (createArrayType) return checker.typeToString(createArrayType.call(checker, elementType));
	const text = checker.typeToString(elementType);
	return /^[\w$]+(\.[\w$]+)*$/.test(text) ? `${text}[]` : `(${text})[]`;
};

/**
 * Both output forms of a rest tuple element, which present it as the array it
 * collects (`...rest: B[]` carries `"B[]"` and an array node) — the
 * flat/structured counterpart of `buildTuple`'s array rewrap, for
 * `extractSnippetParameters`. Paired in one function so the two can't be half
 * applied: a printed array beside a non-array tree would describe two
 * different types.
 *
 * The string prints through the checker's internal `createArrayType` so
 * parenthesization is the printer's own — hand rules get the edges wrong (a
 * `readonly B[]` element *must* parenthesize or `readonly B[][]` denotes a
 * different type, a bare union needs parens, a `unique symbol` prints as a
 * `typeof` query). If the internal factory disappears, the fallback
 * parenthesizes everything but bare identifier paths — sometimes
 * over-parenthesized, never a different type. The tree is presence-gated like
 * any array node (present when the element is a reference or carries
 * structure). `writtenNode` and `aliasRegistry` feed name recovery (and
 * `writtenNode` union member order) like `resolveTypeInfo`'s — the caller
 * passes the same annotation and registry it hands the sibling tree, so the
 * two projections of one element can't disagree on a recovered name.
 */
export const restElementForms = (
	elementType: ts.Type,
	checker: ts.TypeChecker,
	aliasRegistry: AliasRegistry | undefined,
	writtenNode?: ts.TypeNode
): { type: string; typeInfo: TypeJson | undefined } => {
	// depth 1: the element sits under the implicit array root, matching what a
	// signature-path `B[]` parameter would build (one level shallower than the
	// same element inside the prop-level tree, so the depth caps differ by one)
	const node: TypeJson = {
		kind: 'array',
		element: buildTypeJson(
			elementType,
			checker,
			1,
			createNameRecovery(writtenNode, checker, aliasRegistry)
		)
	};
	return {
		type: printRestElementType(elementType, checker),
		typeInfo: hasTypeStructure(node) ? node : undefined
	};
};

/**
 * Build a tuple node with structured elements; `elements` is omitted for the
 * empty tuple, and a `readonly [...]` tuple marks `readonly`. See
 * `TupleElementJson` in `types.ts` for the emitted policy; mechanically, an
 * optional element strips the widening like an optional root, and a rest
 * element rewraps as an array node to match the printed form (the checker
 * flattens concrete tuple spreads, so only unresolved variadics survive
 * as-is).
 */
const buildTuple = (
	type: ts.TypeReference,
	checker: ts.TypeChecker,
	depth: number,
	recovery: NameRecovery
): TypeJson => {
	const isReadonly = (type.target as ts.TupleType).readonly;
	const walked = tupleElements(type, checker);
	if (walked.length === 0) {
		return isReadonly ? { kind: 'tuple', readonly: true } : { kind: 'tuple' };
	}
	const elements = walked.map((el): TupleElementJson => {
		const { target, dropUndefined } = optionalWideningTarget(el.type, checker, el.optional);
		const built = buildTypeJson(target, checker, depth + 1, recovery, { dropUndefined });
		const node: TypeJson = el.rest ? { kind: 'array', element: built } : built;
		// `name` leads the literal so the wire keys read name-first
		const name = tupleElementName(el);
		const element: TupleElementJson = name === undefined ? { type: node } : { name, type: node };
		if (el.optional) element.optional = true;
		if (el.rest || el.variadic) element.rest = true;
		return element;
	});
	return isReadonly ? { kind: 'tuple', elements, readonly: true } : { kind: 'tuple', elements };
};

/**
 * Build a `TypeJson` node for a type. `recovery` threads through the whole
 * walk (recovery can fire at any depth); `options` are positional — see
 * `BuildTypeJsonOptions`.
 */
const buildTypeJson = (
	type: ts.Type,
	checker: ts.TypeChecker,
	depth: number,
	recovery: NameRecovery,
	options: BuildTypeJsonOptions = NO_OPTIONS
): TypeJson => {
	// recovery still applies at the cap — a ~40 B reference beats elided text,
	// and neither channel can misfire here: the written map excludes interned
	// types (intrinsics, literals, type parameters) at build, the registry
	// excludes them at registration, and lookup is by type identity
	if (depth >= MAX_TYPE_JSON_DEPTH) {
		return (
			recoveredReference(type, recovery, depth) ?? { kind: 'other', text: printType(type, checker) }
		);
	}

	if (type.flags & INTRINSIC_FLAGS) return { kind: 'intrinsic', text: printType(type, checker) };

	const literal = literalNode(type, checker);
	if (literal) return literal;

	// recovery precedes union/intersection expansion: an alias-lost union
	// (`z.infer` over a discriminated union) has no alias to label its members
	// with, so a recovered name replaces the expansion outright. The
	// member-set channel is eligible exactly where `dropUndefined` applies —
	// an optional-widened position, the one place a registered `null`-bearing
	// union arrives flattened past identity match
	if (type.isUnion()) {
		const dropUndefined = options.dropUndefined ?? false;
		return (
			recoveredReference(type, recovery, depth, dropUndefined) ??
			buildUnion(type, checker, depth, dropUndefined, recovery)
		);
	}

	if (type.isIntersection()) {
		const recovered = recoveredReference(type, recovery, depth);
		if (recovered) return recovered;
		const members = type.types.map((t) => buildTypeJson(t, checker, depth + 1, recovery));
		const alias = linkableAliasSymbol(type)?.name;
		return alias === undefined
			? { kind: 'intersection', members }
			: { kind: 'intersection', alias, members };
	}

	// after union/intersection so a union of callables keeps its members; a
	// named generic instantiation falls through to the object branch's
	// reference emission even when callable, so `Snippet<[...]>` keeps its type
	// args (`refName` is checked first — flag/symbol reads plus resolved type
	// arguments, while `getCallSignatures` instantiates the type's whole
	// member table). Recovery consults before the terminal `function` node —
	// anonymous callables are exactly the shapes that blow the text budget, and
	// an aliased function type (`Handler`) declines via the nameless gate, so
	// callability stays the classification for everything a checker can name
	const refName = referenceSymbolName(type, checker);
	if (refName === undefined && type.getCallSignatures().length > 0) {
		return (
			recoveredReference(type, recovery, depth) ?? {
				kind: 'function',
				text: printType(type, checker)
			}
		);
	}

	if (type.flags & ts.TypeFlags.Object) {
		// aliased shapes reference by the alias name — the alias is the linkable
		// identity, and its own declaration carries the structure (`type Foo =
		// {...}` nested surfaces as `{kind: 'reference', name: 'Foo'}`)
		// (a svelte2tsx-generated alias is no alias here — see `linkableAliasSymbol`
		// — so its shape falls through to recovery and the structural branches)
		const aliasSymbol = linkableAliasSymbol(type);
		if (aliasSymbol && aliasSymbol.name !== options.skipAliasName) {
			const aliasArgs = type.aliasTypeArguments;
			if (aliasArgs?.length) {
				return {
					kind: 'reference',
					name: aliasSymbol.name,
					typeArgs: aliasArgs.map((t) => buildTypeJson(t, checker, depth + 1, recovery))
				};
			}
			return { kind: 'reference', name: aliasSymbol.name };
		}

		// one consult for every nameless object shape, tuples included — tuple
		// references carry no symbol and recover at the cap, so consulting here
		// keeps sub-cap tuples consistent with capped ones. Arrays and named
		// instantiations decline via the nameless gate (`Array`/`ReadonlyArray`/
		// the instantiation's own symbol), so their structural branches below
		// still run
		const recovered = recoveredReference(type, recovery, depth);
		if (recovered) return recovered;

		if (checker.isArrayType(type)) {
			const elementType = checker.getTypeArguments(type as ts.TypeReference)[0];
			if (elementType) {
				const element = buildTypeJson(elementType, checker, depth + 1, recovery);
				// `isArrayType` matches `ReadonlyArray` references too (`readonly T[]`)
				return namedSymbolName(type) === 'ReadonlyArray'
					? { kind: 'array', element, readonly: true }
					: { kind: 'array', element };
			}
		}

		if (checker.isTupleType(type)) {
			return buildTuple(type as ts.TypeReference, checker, depth, recovery);
		}

		if (refName !== undefined) {
			// `refName` guarantees type arguments (the instantiation gate)
			return {
				kind: 'reference',
				name: refName,
				typeArgs: checker
					.getTypeArguments(type as ts.TypeReference)
					.map((t) => buildTypeJson(t, checker, depth + 1, recovery))
			};
		}

		const symbolName = namedSymbolName(type);
		if (symbolName !== undefined) {
			// a module object is not a named type reference — its symbol name is
			// the quoted specifier, which would ride into `name` quotes and all —
			// so it stays terminal, printing the flat string's `typeof import(…)`
			return isModuleObjectType(type)
				? { kind: 'other', text: printType(type, checker) }
				: { kind: 'reference', name: symbolName };
		}

		return { kind: 'object', text: printType(type, checker) };
	}

	// type parameters, index/conditional types, non-literal enums
	return (
		recoveredReference(type, recovery, depth) ?? { kind: 'other', text: printType(type, checker) }
	);
};

/**
 * The element rule shared by arrays and tuples: an element makes its container
 * qualify when it is a reference (`Tome[]` is linkable, `string[]` is not) or
 * carries structure of its own.
 */
const elementQualifies = (node: TypeJson): boolean =>
	node.kind === 'reference' || hasTypeStructure(node);

/**
 * Whether a node says anything at all beyond its `kind` — the empty tuple
 * (`{kind: 'tuple'}`) is the one `TypeJson` shape with no `text`, `name`,
 * `element`, `members`, or `elements` to say it with. (`readonly` doesn't
 * count: it's a modifier on nothing, and the flat string carries it.)
 */
const carriesPayload = (node: TypeJson): boolean =>
	node.kind !== 'tuple' || node.elements !== undefined;

/**
 * Whether a node carries structure the flat type string can't — the presence
 * test behind the `TypeJson` absence contract. Union/intersection members
 * always qualify; arrays and tuples qualify when an element does
 * (`elementQualifies`); a reference qualifies on any type argument that says
 * something (`carriesPayload`), which is every instantiation except one over
 * the empty tuple — `Snippet<[]>` prints itself in full, so its tree would be
 * a wrapper around nothing.
 */
const hasTypeStructure = (node: TypeJson): boolean => {
	switch (node.kind) {
		case 'union':
		case 'intersection':
			return true;
		case 'reference':
			return node.typeArgs?.some(carriesPayload) ?? false;
		case 'array':
			return elementQualifies(node.element);
		case 'tuple':
			return node.elements?.some((el) => elementQualifies(el.type)) ?? false;
		default:
			return false;
	}
};

/**
 * Node kinds whose content the type-alias declaration already publishes through
 * its own `members` — an object literal's properties and a callable's `(call)`
 * signature both extract as members, so emitting the printed text beside them
 * is pure duplication. Every other kind is worth emitting at a self-named root.
 */
const REDUNDANT_WITH_MEMBERS = new Set<TypeJson['kind']>(['object', 'function']);

/** Declaration-site context for `resolveTypeInfo` — see its param doc. */
export interface ResolveTypeInfoOptions {
	/** At a type-alias declaration site, the alias's own name. */
	ownAliasName?: string;
	/** The declaration's written type annotation, when one exists. */
	writtenNode?: ts.TypeNode;
}

/**
 * The structured type for an output field, or `undefined` when the flat
 * string is the whole story (the `TypeJson` absence contract).
 *
 * Matches `getTypeSignature`'s optional handling by construction — both
 * select through `optionalWideningTarget` (see there for the case split);
 * `x?: undefined` stays terminal. What's specific to the tree: union members
 * walk the union's `origin` (see `unionMemberTypes`), so a `null`-bearing
 * optional alias survives: dropping the widening from the origin list leaves
 * the alias-carrying union as the sole member, which the 1-member collapse
 * promotes to the root (`a?: A` where `A` is nullable yields the `A` union,
 * matching the flat string's printed-string surgery). When no usable `origin`
 * exists both degrade together, bounded: alias lost. Members then take the
 * written order where a written union node is recoverable
 * (`writtenUnionMemberTypes`), so they can list in a different order from the
 * flat string, which always prints in the checker's.
 *
 * **Self-named alias roots relax the contract.** `checker.typeToString` prints
 * a type carrying an alias symbol as that alias's bare name, so a type alias's
 * own `typeSignature` reads `"StrArr"`, not `"string[]"` — there is no
 * descriptive flat sibling for the tree to defer to, and the usual gate would
 * leave `type StrArr = string[]` and `type Pair = [string, number]` with no
 * type information at all. When the type reports `ownAliasName` as its alias
 * the node is emitted regardless, except for the kinds `members` already
 * covers (`REDUNDANT_WITH_MEMBERS`). Interned types (intrinsics, literals)
 * never carry the alias symbol, so `type Str = string` still prints
 * structurally and stays absent.
 *
 * **Recovered roots relax it too.** When `writtenNode` or `aliasRegistry`
 * names a nameless type, the tree emits `{kind: 'reference', name}` (see
 * `buildWrittenNameMap` / `recoveredReference`) — and at the root that node is
 * emitted even though a bare reference normally stays absent: a checker-named
 * bare reference defers to a flat sibling printing the same name, while a
 * recovered one stands against a flat sibling printing the anonymous
 * expansion, so the name exists only in the tree.
 *
 * **Generated-alias roots relax it too.** A type whose alias is
 * svelte2tsx-generated (`linkableAliasSymbol`) prints as that name in the flat
 * string (`$$ComponentProps`), which nothing exports, so the node is emitted
 * with the structure expanded — and so is an array or tuple over one
 * (`$$ComponentProps[]`), whose expanded object element wouldn't otherwise
 * qualify (`printsGeneratedAlias`). At a type-alias declaration the
 * `REDUNDANT_WITH_MEMBERS` kinds still stay absent, since `members` carries
 * them.
 *
 * @param type - the checker type the flat string was printed from
 * @param checker - TypeScript type checker
 * @param aliasRegistry - the analyzed set's alias registry, or `undefined` when no pre-pass ran; required so a call site can't silently opt out of registry recovery
 * @param optional - whether the declaration site carries a `?` token (pairs the widening strip, like `getTypeSignature`)
 * @param options - the declaration-site context: `ownAliasName` at a type-alias declaration (see `BuildTypeJsonOptions.skipAliasName`; also suppresses registry hits at the root — the self-skip), `writtenNode` wherever a written annotation exists (the name-recovery source for aliases TypeScript dropped, and the written order for union members)
 */
export const resolveTypeInfo = (
	type: ts.Type,
	checker: ts.TypeChecker,
	aliasRegistry: AliasRegistry | undefined,
	optional: boolean,
	options?: ResolveTypeInfoOptions
): TypeJson | undefined => {
	const ownAliasName = options?.ownAliasName;
	const recovery = createNameRecovery(
		options?.writtenNode,
		checker,
		aliasRegistry,
		ownAliasName !== undefined
	);
	const { target, dropUndefined } = optionalWideningTarget(type, checker, optional);
	const node = buildTypeJson(target, checker, 0, recovery, {
		dropUndefined,
		skipAliasName: ownAliasName
	});
	if (hasTypeStructure(node)) return node;
	// a recovered bare reference at the root carries the name the flat string
	// lost — re-derived with root semantics (depth 0, member-set eligibility
	// matching the build) so this check can't disagree with the build above
	if (
		node.kind === 'reference' &&
		recoveredReference(target, recovery, 0, dropUndefined) !== undefined
	) {
		return node;
	}
	// the flat string prints svelte2tsx's generated alias name, which nothing
	// can look up, so the tree is the only place the structure shows
	if (printsGeneratedAlias(target, checker)) {
		return ownAliasName !== undefined && REDUNDANT_WITH_MEMBERS.has(node.kind) ? undefined : node;
	}
	// the flat string is the bare alias name, so absence would say nothing
	if (ownAliasName !== undefined && type.aliasSymbol?.name === ownAliasName) {
		if (REDUNDANT_WITH_MEMBERS.has(node.kind)) return undefined;
		// a terminal node printed at this root would repeat the alias name
		// (`type A<T> = T extends string ? 'a' : 'b'` prints as `A<T>`), so
		// reprint with the flag that expands what the alias stands for
		return 'text' in node ? { ...node, text: printAliasedType(type, checker) } : node;
	}
	return undefined;
};
