/**
 * Structured type extraction — builds `TypeJson` trees from checker types.
 *
 * The structured counterpart to `getTypeSignature` (in
 * `typescript-extract-shared.ts`): `resolveTypeInfo` mirrors its
 * optional-strip selection exactly so the flat string and the tree describe
 * the same type, then applies the `TypeJson` absence contract — returning
 * `undefined` when the node carries no structure beyond the flat string.
 * Expansion, alias, and normalization policy live on the `TypeJson` schema
 * doc in `types.ts`.
 *
 * @internal Used by the extractors — not part of the public barrel export.
 *
 * @module
 */

import ts from 'typescript';

import type { TypeJson } from './types.ts';

/**
 * Recursion cap for `TypeJson` trees; nodes at the cap degrade to
 * `{kind: 'other', text}`. Bounds pathological nesting and terminates the one
 * unbounded walk a recursive alias can produce (`type Json = string | Json[]`
 * cycles through union members and array elements).
 */
const MAX_TYPE_JSON_DEPTH = 5;

/**
 * Terminal `text` fields are load-bearing (the node has no other content), so
 * they opt out of the checker's default ~160-char truncation. The flat type
 * strings deliberately keep it — they are the checker's canonical rendering.
 */
const printType = (type: ts.Type, checker: ts.TypeChecker): string =>
	checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);

/**
 * `printType` for a type standing at its own alias's declaration, where the
 * default rendering is the alias name itself. `InTypeAlias` is the printer flag
 * for exactly this position — it writes what the alias expands to.
 */
const printAliasedType = (type: ts.Type, checker: ts.TypeChecker): string =>
	checker.typeToString(
		type,
		undefined,
		ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias
	);

/** Whether the type is `null` or a union with a `null` member. */
export const hasNullMember = (type: ts.Type): boolean =>
	type.isUnion()
		? type.types.some((t) => !!(t.flags & ts.TypeFlags.Null))
		: !!(type.flags & ts.TypeFlags.Null);

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
 * Root-only build options. Recursive calls never pass options — both concerns
 * exist only where the tree meets its flat-string sibling.
 */
interface BuildTypeJsonOptions {
	/** Filter the optional-widening `undefined` member from a root union. */
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
	dropUndefined: boolean
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
		members.push(buildTypeJson(memberType, checker, depth + 1));
	}

	if (members.length === 0) return { kind: 'other', text: printType(type, checker) };
	if (members.length === 1) return members[0]!;

	const alias = unionAlias(type);
	return alias === undefined ? { kind: 'union', members } : { kind: 'union', alias, members };
};

/** Build a `TypeJson` node for a type. `options` apply to the root call only. */
const buildTypeJson = (
	type: ts.Type,
	checker: ts.TypeChecker,
	depth: number,
	options: BuildTypeJsonOptions = NO_OPTIONS
): TypeJson => {
	if (depth >= MAX_TYPE_JSON_DEPTH) return { kind: 'other', text: printType(type, checker) };

	if (type.flags & INTRINSIC_FLAGS) return { kind: 'intrinsic', text: printType(type, checker) };

	const literal = literalNode(type, checker);
	if (literal) return literal;

	if (type.isUnion()) return buildUnion(type, checker, depth, options.dropUndefined ?? false);

	if (type.isIntersection()) {
		const members = type.types.map((t) => buildTypeJson(t, checker, depth + 1));
		const alias = type.aliasSymbol?.name;
		return alias === undefined
			? { kind: 'intersection', members }
			: { kind: 'intersection', alias, members };
	}

	// after union/intersection so a union of callables keeps its members
	if (type.getCallSignatures().length > 0) {
		return { kind: 'function', text: printType(type, checker) };
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
					typeArgs: aliasArgs.map((t) => buildTypeJson(t, checker, depth + 1))
				};
			}
			return { kind: 'reference', name: type.aliasSymbol.name };
		}

		if (checker.isArrayType(type)) {
			const element = checker.getTypeArguments(type as ts.TypeReference)[0];
			if (element) {
				return { kind: 'array', element: buildTypeJson(element, checker, depth + 1) };
			}
		}

		// tuples are terminal in round one; snippet tuples carry their structure
		// through `ComponentPropJson.parameters` instead
		if (checker.isTupleType(type)) return { kind: 'other', text: printType(type, checker) };

		const objectFlags = (type as ts.ObjectType).objectFlags;
		const symbolName = type.symbol?.name;
		// internal symbol names (`__type`, `__object`, `__function`) mark anonymous shapes
		const named = symbolName !== undefined && symbolName !== '' && !symbolName.startsWith('__');

		if (objectFlags & ts.ObjectFlags.Reference && named) {
			const typeArgs = checker.getTypeArguments(type as ts.TypeReference);
			if (typeArgs.length > 0) {
				return {
					kind: 'reference',
					name: symbolName,
					typeArgs: typeArgs.map((t) => buildTypeJson(t, checker, depth + 1))
				};
			}
			return { kind: 'reference', name: symbolName };
		}

		if (named) return { kind: 'reference', name: symbolName };

		return { kind: 'object', text: printType(type, checker) };
	}

	// type parameters, index/conditional types, non-literal enums
	return { kind: 'other', text: printType(type, checker) };
};

/**
 * Whether a node carries structure the flat type string can't — the presence
 * test behind the `TypeJson` absence contract. Union/intersection members and
 * reference type arguments always qualify; an array qualifies when its element
 * does (or is a reference — `Tome[]` is linkable, `string[]` is not).
 */
const hasTypeStructure = (node: TypeJson): boolean => {
	switch (node.kind) {
		case 'union':
		case 'intersection':
			return true;
		case 'reference':
			return node.typeArgs !== undefined;
		case 'array':
			return node.element.kind === 'reference' || hasTypeStructure(node.element);
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

/**
 * The structured type for an output field, or `undefined` when the flat
 * string is the whole story (the `TypeJson` absence contract).
 *
 * Mirrors `getTypeSignature`'s optional handling so the tree matches the flat
 * string: `x?: undefined` stays terminal; a `null`-free optional walks
 * `getNonNullableType` (which preserves the alias symbol); a `null`-bearing
 * optional walks the raw union with only the widening `undefined` member
 * dropped, keeping `null`. Union members walk the union's `origin` (see
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
 * leave `type StrArr = string[]` and `type Tup = [a: string, b: B]` with no
 * type information at all. When the type reports `ownAliasName` as its alias
 * the node is emitted regardless, except for the kinds `members` already
 * covers (`REDUNDANT_WITH_MEMBERS`). Interned types (intrinsics, literals)
 * never carry the alias symbol, so `type Str = string` still prints
 * structurally and stays absent.
 *
 * @param type - the checker type the flat string was printed from
 * @param checker - TypeScript type checker
 * @param optional - whether the declaration site carries a `?` token (pairs the widening strip, like `getTypeSignature`)
 * @param ownAliasName - at a type-alias declaration site, the alias's own name (see `BuildTypeJsonOptions.skipAliasName`)
 */
export const resolveTypeInfo = (
	type: ts.Type,
	checker: ts.TypeChecker,
	optional: boolean,
	ownAliasName?: string
): TypeJson | undefined => {
	let target = type;
	let dropUndefined = false;
	if (optional) {
		// `x?: undefined` — the whole type is the widening; terminal either way
		if (!type.isUnion() && type.flags & ts.TypeFlags.Undefined) return undefined;
		if (hasNullMember(type)) {
			dropUndefined = true;
		} else {
			target = checker.getNonNullableType(type);
		}
	}
	const node = buildTypeJson(target, checker, 0, { dropUndefined, skipAliasName: ownAliasName });
	if (hasTypeStructure(node)) return node;
	// the flat string is the bare alias name, so absence would say nothing
	if (ownAliasName !== undefined && type.aliasSymbol?.name === ownAliasName) {
		if (REDUNDANT_WITH_MEMBERS.has(node.kind)) return undefined;
		// a terminal node printed at this root would repeat the alias name
		// (`type Tup = [a: string, b: B]` → `{kind: 'other', text: 'Tup'}`), so
		// reprint with the flag that expands what the alias stands for
		return 'text' in node ? { ...node, text: printAliasedType(type, checker) } : node;
	}
	return undefined;
};
