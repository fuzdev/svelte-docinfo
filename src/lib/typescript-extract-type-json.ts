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
 * recursive types with a name). Expansion, alias, and normalization policy
 * live on the `TypeJson` schema doc in `types.ts`.
 *
 * @internal Used by the extractors — not part of the public barrel export.
 *
 * @module
 */

import ts from 'typescript';

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
 *   widening coincide), `x?: unknown` and `x?: any` (both absorb `undefined`),
 *   and every optional under `exactOptionalPropertyTypes` (which doesn't widen
 *   at all). `getNonNullableType` must not run on any of them — it answers
 *   `{}` for `unknown`, which would report `x?: unknown` as `"{}"`
 * - a `null`-bearing union keeps its shape and reports `dropUndefined` — the
 *   walk drops only the widening member (so the alias survives) and the
 *   printer trims the printed suffix
 * - a union left with exactly one member after dropping `undefined` takes that
 *   member directly — it *is* the annotated type. Matters for a bare
 *   unconstrained type parameter (`c?: E`), where `getNonNullableType` can
 *   only answer `NonNullable<E>` and would print `E & {}`
 * - every other union takes `getNonNullableType`, which rebuilds the union
 *   rather than picking a member (so a union of callables keeps its combined
 *   call signature) and preserves the alias symbol
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
 * Whether the checker kept no name for a type-alias declaration's resolved
 * type: no alias symbol (the checker still prints `type A = B` as `B`), no
 * nominal symbol (interfaces/classes/enums print their own name), and not an
 * interned terminal (`type A = string` and `type A = 'x'` carry no alias
 * symbol either but print fine). True exactly for the expansion-prone class
 * the alias registry targets and the `alias_lost` diagnostic reports —
 * indexed-access and conditional right-hand sides (`z.infer<typeof S>` et
 * al.), whose resolution lands on a pre-existing interned type that TypeScript
 * never retroactively stamps an alias symbol on.
 */
export const isAliasLostType = (type: ts.Type): boolean =>
	type.aliasSymbol === undefined &&
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
 * The importable name a written type reference resolves to — through import
 * aliases (`import {Original as Renamed}` yields `Original`), so the recovered
 * name is the one a consumer can look up, not a file-local spelling.
 */
const referenceNodeName = (
	node: ts.TypeReferenceNode,
	checker: ts.TypeChecker
): string | undefined => {
	let symbol = checker.getSymbolAtLocation(node.typeName);
	if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
	return symbol?.name;
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
					if (name !== undefined) map.set(type, name);
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

/**
 * The two recovery channels threaded through a tree build, plus the self-skip
 * flag. Constructed once per `resolveTypeInfo`/`restElementForms` call.
 */
interface NameRecovery {
	/** Names from the written annotation at this site, when one exists. */
	written: WrittenNameLookup | undefined;
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
 */
const recoveredReference = (
	type: ts.Type,
	recovery: NameRecovery,
	depth: number,
	memberSetEligible = false
): TypeJson | undefined => {
	if (recovery.written === undefined && recovery.registry === undefined) return undefined;
	if (type.aliasSymbol !== undefined || namedSymbolName(type) !== undefined) return undefined;
	const written = recovery.written?.(type);
	if (written !== undefined) return { kind: 'reference', name: written };
	const { registry } = recovery;
	if (registry === undefined) return undefined;
	if (depth === 0 && recovery.suppressRegistryAtRoot) return undefined;
	const entry = registry.byType.get(type);
	if (entry) return { kind: 'reference', name: entry.name };
	if (memberSetEligible && type.isUnion()) {
		const key = unionMemberSetKey(type);
		const side = key === undefined ? undefined : registry.byMemberSet.get(key);
		if (side) return { kind: 'reference', name: side.name };
	}
	return undefined;
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
	type.aliasSymbol?.name ?? (type.flags & ts.TypeFlags.EnumLiteral ? type.symbol?.name : undefined);

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
 * Union members in written order where recoverable. `ts.UnionType.types` is
 * the checker's normalized list — flattened and sorted by internal type id, an
 * order that interleaves the authored one (`'a' | 'b' | null` normalizes to
 * `null, "a", "b"`) and can shift with what interned first elsewhere in the
 * program. The printer recovers the written form through the union's `origin`
 * — the denormalized union the flat strings are printed from — so the tree
 * walks the same field: members keep the origin's order (plain members before
 * named sub-unions, the checker's own convention), and a member written as a
 * named sub-union survives as its own alias-carrying node (`E | null` keeps
 * `E` instead of flattening to enum literals). `sinkNullishLast` completes
 * the match with the printed order.
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
 * Reorder members to the printer's convention: `null` then `undefined` sink to
 * the end, everything else keeps its list order. The printer applies this to
 * whatever list it prints from — a written `null | string` prints as
 * `"string | null"`, and `origin` stores nullish members *first* — so the tree
 * applies it too: the contract is matching the flat string, not any internal
 * list.
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
	let memberTypes: ReadonlyArray<ts.Type> = sinkNullishLast(unionMemberTypes(type));
	if (dropUndefined) {
		memberTypes = memberTypes.filter((t) => !(t.flags & ts.TypeFlags.Undefined));
	}

	// Collapse the checker's boolean expansion (`true | false`) back to `boolean`,
	// at the position of the first literal. Without this an optional `boolean`
	// prop would surface as a `'true' | 'false'` literal union after the
	// widening strip. A lone boolean literal stays a literal. Only reachable on
	// the normalized-list fallback — the origin walk keeps `boolean` whole.
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
 * structure). `writtenNode` and `aliasRegistry` feed name recovery like
 * `resolveTypeInfo`'s — the caller passes the same annotation and registry it
 * hands the sibling tree, so the two projections of one element can't disagree
 * on a recovered name.
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
		const alias = type.aliasSymbol?.name;
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
		if (type.aliasSymbol && type.aliasSymbol.name !== options.skipAliasName) {
			const aliasArgs = type.aliasTypeArguments;
			if (aliasArgs?.length) {
				return {
					kind: 'reference',
					name: type.aliasSymbol.name,
					typeArgs: aliasArgs.map((t) => buildTypeJson(t, checker, depth + 1, recovery))
				};
			}
			return { kind: 'reference', name: type.aliasSymbol.name };
		}

		// one consult for every nameless object shape, tuples included (sub-cap
		// tuples never consulted before — tuple references carry no symbol, so
		// they *did* recover at the cap, an inconsistency this placement closes).
		// Arrays and named instantiations decline via the nameless gate
		// (`Array`/`ReadonlyArray`/the instantiation's own symbol), so their
		// structural branches below still run
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
		if (symbolName !== undefined) return { kind: 'reference', name: symbolName };

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
 * walk the union's `origin` (see
 * `unionMemberTypes`), so member order matches the printed string and a
 * `null`-bearing optional alias survives: dropping the widening from the
 * origin list leaves the alias-carrying union as the sole member, which the
 * 1-member collapse promotes to the root (`a?: A` where `A` is nullable
 * yields the `A` union, matching the flat string's printed-string surgery).
 * When no usable `origin` exists both degrade together, bounded: checker-
 * internal member order, alias lost.
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
 * @param type - the checker type the flat string was printed from
 * @param checker - TypeScript type checker
 * @param aliasRegistry - the analyzed set's alias registry, or `undefined` when no pre-pass ran; required so a call site can't silently opt out of registry recovery
 * @param optional - whether the declaration site carries a `?` token (pairs the widening strip, like `getTypeSignature`)
 * @param options - the declaration-site context: `ownAliasName` at a type-alias declaration (see `BuildTypeJsonOptions.skipAliasName`; also suppresses registry hits at the root — the self-skip), `writtenNode` wherever a written annotation exists (the name-recovery source for aliases TypeScript dropped)
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
