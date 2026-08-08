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
 * when the node carries no structure beyond the flat string. Expansion,
 * alias, and normalization policy live on the `TypeJson` schema doc in
 * `types.ts`.
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
	return { target: checker.getNonNullableType(type), dropUndefined: false };
};

/** The type's non-anonymous symbol name (`__type`/`__object`/`__function` mark anonymous shapes). */
const namedSymbolName = (type: ts.Type): string | undefined => {
	const name = type.symbol?.name;
	return name && !name.startsWith('__') ? name : undefined;
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
 * structure).
 */
export const restElementForms = (
	elementType: ts.Type,
	checker: ts.TypeChecker
): { type: string; typeInfo: TypeJson | undefined } => {
	// depth 1: the element sits under the implicit array root, matching what a
	// signature-path `B[]` parameter would build (one level shallower than the
	// same element inside the prop-level tree, so the depth caps differ by one)
	const node: TypeJson = { kind: 'array', element: buildTypeJson(elementType, checker, 1) };
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
const buildTuple = (type: ts.TypeReference, checker: ts.TypeChecker, depth: number): TypeJson => {
	const isReadonly = (type.target as ts.TupleType).readonly;
	const walked = tupleElements(type, checker);
	if (walked.length === 0) {
		return isReadonly ? { kind: 'tuple', readonly: true } : { kind: 'tuple' };
	}
	const elements = walked.map((el): TupleElementJson => {
		const { target, dropUndefined } = optionalWideningTarget(el.type, checker, el.optional);
		const built = buildTypeJson(target, checker, depth + 1, { dropUndefined });
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

/** Build a `TypeJson` node for a type. `options` are positional — see `BuildTypeJsonOptions`. */
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

	// after union/intersection so a union of callables keeps its members; a
	// named generic instantiation falls through to the object branch's
	// reference emission even when callable, so `Snippet<[...]>` keeps its type
	// args (`refName` is checked first — flag/symbol reads plus resolved type
	// arguments, while `getCallSignatures` instantiates the type's whole
	// member table)
	const refName = referenceSymbolName(type, checker);
	if (refName === undefined && type.getCallSignatures().length > 0) {
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
			const elementType = checker.getTypeArguments(type as ts.TypeReference)[0];
			if (elementType) {
				const element = buildTypeJson(elementType, checker, depth + 1);
				// `isArrayType` matches `ReadonlyArray` references too (`readonly T[]`)
				return namedSymbolName(type) === 'ReadonlyArray'
					? { kind: 'array', element, readonly: true }
					: { kind: 'array', element };
			}
		}

		if (checker.isTupleType(type)) return buildTuple(type as ts.TypeReference, checker, depth);

		if (refName !== undefined) {
			// `refName` guarantees type arguments (the instantiation gate)
			return {
				kind: 'reference',
				name: refName,
				typeArgs: checker
					.getTypeArguments(type as ts.TypeReference)
					.map((t) => buildTypeJson(t, checker, depth + 1))
			};
		}

		const symbolName = namedSymbolName(type);
		if (symbolName !== undefined) return { kind: 'reference', name: symbolName };

		return { kind: 'object', text: printType(type, checker) };
	}

	// type parameters, index/conditional types, non-literal enums
	return { kind: 'other', text: printType(type, checker) };
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
	const { target, dropUndefined } = optionalWideningTarget(type, checker, optional);
	const node = buildTypeJson(target, checker, 0, { dropUndefined, skipAliasName: ownAliasName });
	if (hasTypeStructure(node)) return node;
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
