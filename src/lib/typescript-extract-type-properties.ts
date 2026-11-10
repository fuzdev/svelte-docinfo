/**
 * Property extraction for TypeScript type aliases, and for the computed
 * heritage of interfaces.
 *
 * `extractTypeAliasProperties` walks the resolved type and emits members for
 * named properties, index signatures, call signatures, and construct
 * signatures. Handles object literals, intersections, mapped types
 * (Partial, Pick, Readonly, etc.), type references, and function types.
 * Called by `extractTypeInfo` in `typescript-extract-type.ts` for type
 * aliases. Interfaces walk their own `node.members` there, and take what a
 * computed `extends` entry contributes from `extractComputedHeritageMembers`,
 * which projects it the way this module projects an alias.
 *
 * @see `typescript-extract-shared.ts` for shared helpers
 * @see `typescript-extract-type.ts` for the dispatcher
 *
 * @internal
 *
 * @module
 */

import ts from 'typescript';

import type { DeclarationModifier } from './types.ts';
import type { DeclarationJsonBuild, MemberJsonBuild } from './declaration-build.ts';
import { toErrorMessage } from './error.ts';
import { parseComment } from './tsdoc.ts';
import {
	resolveTypeInfo,
	typeAliasTypeNode,
	writtenTypeAnnotation,
	type TypeAliasLike
} from './typescript-extract-type-json.ts';
import { type IsExternalFile } from './typescript-program.ts';
import {
	emitCallOrConstructSignature,
	filterDocumentedProperties,
	getNodeLocation,
	isExternalIndexInfo,
	isExternalSignature,
	populatePropertyMember,
	type ExtractContext
} from './typescript-extract-shared.ts';

/**
 * Check whether a resolved type has properties worth extracting for documentation.
 *
 * Returns `true` for object-like types (object literals, intersections, mapped
 * types, project-local generic instantiations, function types). Returns `false`
 * for types where `getProperties()` would return prototype methods or ambiguous
 * results (unions, primitives, tuples, lib/external generic references like
 * `Array<T>`, `Promise<T>`).
 */
const hasExtractableProperties = (type: ts.Type, isExternalFile: IsExternalFile): boolean => {
	// Intersections: checker merges properties from all branches
	if (type.isIntersection()) return true;

	// Unions: ambiguous property set (different branches have different shapes)
	if (type.isUnion()) return false;

	// Must be an object type
	if (!(type.flags & ts.TypeFlags.Object)) return false;

	const objFlags = (type as ts.ObjectType).objectFlags;

	// Tuples give array prototype methods — not useful
	if (objFlags & ts.ObjectFlags.Tuple) return false;

	// Generic type references give prototype methods when the target is a lib
	// or external type (Array<T>, Promise<T>, Set<T>) — but an instantiation of
	// a *project-local* generic interface or class is the author's own shape,
	// with instantiated members worth documenting. Mapped types can also have
	// Reference when instantiated (Partial<T>, Pick<T,K>), so Reference is
	// allowed when Mapped is also set.
	if (objFlags & ts.ObjectFlags.Reference && !(objFlags & ts.ObjectFlags.Mapped)) {
		const targetDecls = (type as ts.TypeReference).target.symbol?.getDeclarations();
		return !!targetDecls?.length && targetDecls.every((d) => !isExternalFile(d.getSourceFile()));
	}

	return true;
};

/**
 * Get the index info for a type, dropping external contributions by
 * declaration origin.
 *
 * The rule matches the per-property membership test: an index signature whose
 * declaration lives in an external file is dropped — at a bare root
 * (`type P = ExtIndexOnly`), through local inheritance (`LocalBase extends
 * ExtIndex`, whose inherited info preserves the external declaration), and in
 * intersections alike — while a declaration-less info is kept (fail-open: the
 * checker synthesizes those for mapped-type instantiations like
 * `Record<string, X>` and `Partial<Indexed>`, whose content flows from the
 * written site).
 *
 * Intersections are tested per constituent rather than on the merged info —
 * merging two same-kind signatures loses the declaration, and the first local
 * constituent's own info is the one the author's branch contributes. Multiple
 * local constituents with same-kind signatures keep the first (conservative;
 * exceedingly rare in practice).
 *
 * The info carries the signature's `declaration` beside its type, so the
 * emitter can feed the written annotation to `typeInfo` name recovery.
 */
const extractLocalIndexInfo = (
	nodeType: ts.Type,
	checker: ts.TypeChecker,
	isExternalFile: IsExternalFile,
	indexKind: ts.IndexKind
): ts.IndexInfo | undefined => {
	// one candidate for a plain type, one per constituent for an intersection —
	// the same "first local info wins" rule either way
	const candidates = nodeType.isIntersection() ? nodeType.types : [nodeType];
	for (const candidate of candidates) {
		const info = checker.getIndexInfoOfType(candidate, indexKind);
		if (info && !isExternalIndexInfo(info, isExternalFile)) return info;
	}
	return undefined;
};

/**
 * Resolve, emit, and diagnose a local index signature for a type alias, or
 * for an interface's computed heritage entry.
 *
 * Wraps `extractLocalIndexInfo` with the boilerplate shared by string and
 * number kinds: push a `[key: string]` / `[key: number]` member when found,
 * flip `partial: true` and add a `type_extraction_failed` diagnostic on
 * checker errors. Pulled out of the call site to avoid copy-paste drift
 * between the two kinds.
 *
 * @mutates declaration - appends a member when an index sig is present
 * @mutates diagnostics - adds a `type_extraction_failed` diagnostic on checker error
 */
const emitLocalIndexSignature = (
	declaration: DeclarationJsonBuild,
	nodeType: ts.Type,
	node: ts.Node,
	ctx: ExtractContext,
	kind: 'string' | 'number'
): void => {
	const { checker, diagnostics } = ctx;
	const indexKind = kind === 'string' ? ts.IndexKind.String : ts.IndexKind.Number;
	try {
		const indexInfo = extractLocalIndexInfo(nodeType, checker, ctx.isExternalFile, indexKind);
		if (indexInfo) {
			const member: MemberJsonBuild = {
				name: `[key: ${kind}]`,
				kind: 'variable',
				// no optional strip on either output — `optional` is N/A for index signatures
				typeSignature: checker.typeToString(indexInfo.type)
			};
			// `readonly [key: string]: T` carries the modifier like a property
			if (indexInfo.isReadonly) member.modifiers = ['readonly'];
			const typeInfo = resolveTypeInfo(indexInfo.type, checker, ctx.aliasRegistry, false, {
				writtenNode: indexInfo.declaration?.type
			});
			if (typeInfo) member.typeInfo = typeInfo;
			(declaration.members ??= []).push(member);
		}
	} catch (err) {
		declaration.partial = true;
		const loc = getNodeLocation(node);
		diagnostics.push({
			kind: 'type_extraction_failed',
			file: loc.file,
			line: loc.line,
			column: loc.column,
			message: `Failed to extract ${kind} index signature for type "${declaration.name ?? '<default export>'}": ${toErrorMessage(err)}`,
			severity: 'warning',
			symbolName: declaration.name ?? '<default export>'
		});
	}
};

/**
 * Detect whether a property symbol is readonly.
 *
 * Two-layer detection:
 * 1. Check property declarations for `readonly` modifier (works for object literals,
 *    intersections, type references)
 * 2. For mapped types with a `readonly` token (e.g., `Readonly<T>`,
 *    `{ readonly [K in ...]: ... }`), all properties are readonly regardless
 *    of the original declaration
 */
const isReadonlyProperty = (prop: ts.Symbol, mappedReadonly: boolean): boolean => {
	const decls = prop.getDeclarations();
	if (decls) {
		for (const decl of decls) {
			// a JS class's `@readonly` field or `this.x` too, as on the class itself
			// (`extractModifiers`)
			if (ts.getCombinedModifierFlags(decl) & ts.ModifierFlags.Readonly) return true;
		}
	}
	return mappedReadonly;
};

/**
 * Whether a mapped type carries a `readonly` token (`Readonly<T>`,
 * `{ readonly [K in …]: … }`), which makes every property it maps readonly
 * whatever the source declaration says.
 */
const isReadonlyMappedType = (type: ts.Type): boolean => {
	if (!(type.flags & ts.TypeFlags.Object)) return false;
	if (!((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Mapped)) return false;
	// ts.MappedType is not in the public API, but the `declaration` property
	// exists at runtime on mapped types and holds the MappedTypeNode AST node
	const mappedDecl = (type as ts.ObjectType & { declaration?: ts.MappedTypeNode }).declaration;
	return !!mappedDecl?.readonlyToken;
};

/**
 * Project already-filtered property symbols of a structural type into
 * members: optionality and readonly from the symbol (and the owning mapped
 * type's `readonly` token), TSDoc from the property's first declaration, and
 * the kind, type, and docs through `populatePropertyMember`.
 *
 * The one property projection the type-alias path and an interface's
 * computed heritage share, so a property reads the same through either.
 *
 * @param ownerType - the type the properties were read from, for its mapped `readonly`
 * @param location - the node properties are typed at, and the param-validation fallback
 * @mutates declaration - appends a member per property
 * @mutates ctx.diagnostics - via `populatePropertyMember`
 */
const emitPropertyMembers = (
	properties: ReadonlyArray<ts.Symbol>,
	ownerType: ts.Type,
	location: ts.Node,
	declaration: DeclarationJsonBuild,
	ctx: ExtractContext
): void => {
	const { checker } = ctx;
	const mappedReadonly = isReadonlyMappedType(ownerType);
	for (const prop of properties) {
		// Skip internal TypeScript symbols
		if (prop.getName().startsWith('__@')) continue;

		const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
		const readonly = isReadonlyProperty(prop, mappedReadonly);

		let propType: ts.Type;
		try {
			propType = checker.getTypeOfSymbolAtLocation(prop, location);
		} catch {
			continue;
		}

		const member: MemberJsonBuild = {
			name: prop.getName(),
			kind: 'variable'
		};

		if (optional) member.optional = true;

		// Modifiers
		const modifiers: Array<DeclarationModifier> = [];
		if (readonly) modifiers.push('readonly');
		if (modifiers.length > 0) member.modifiers = modifiers;

		// Parse TSDoc from the property's declaration if available
		const decls = prop.getDeclarations();
		const propDecl = decls?.[0];
		const propTsdoc = propDecl ? parseComment(propDecl, propDecl.getSourceFile()) : undefined;

		const annotation =
			propDecl &&
			(ts.isPropertySignature(propDecl) ||
				ts.isPropertyDeclaration(propDecl) ||
				ts.isJSDocPropertyTag(propDecl))
				? writtenTypeAnnotation(propDecl)
				: undefined;
		// owns the TSDoc application too — `@default` gates on the settled kind
		populatePropertyMember(
			member,
			propType,
			ctx,
			optional,
			propTsdoc,
			propDecl ?? location,
			prop.getName(),
			annotation
		);

		(declaration.members ??= []).push(member);
	}
};

/**
 * Whether a heritage entry's type is a named interface or class, or an
 * instantiation of one (`Base<string>`), project-declared or not. Its members
 * belong to that declaration, which `extends` names; anything else an
 * interface can extend is computed: a mapped, conditional, or indexed-access
 * type, a utility-type instantiation (`Omit<Base, 'a'>`), an intersection, or
 * an object literal type behind an alias. An alias of an interface
 * (`type B = Base`) resolves to the interface's type, so it is named too.
 */
const isNamedHeritageType = (type: ts.Type): boolean => {
	if (!(type.flags & ts.TypeFlags.Object)) return false;
	const target =
		(type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference
			? (type as ts.TypeReference).target
			: type;
	return target.isClassOrInterface();
};

/**
 * The index-signature key kinds (`string`, `number`) an interface declares in
 * any of its blocks: TypeScript inherits an index signature only for a key
 * type the interface hasn't declared.
 */
const ownIndexKinds = (symbol: ts.Symbol | undefined): Set<ts.IndexKind> => {
	const kinds: Set<ts.IndexKind> = new Set();
	for (const decl of symbol?.members?.get(ts.InternalSymbolName.Index)?.getDeclarations() ?? []) {
		if (!ts.isIndexSignatureDeclaration(decl)) continue;
		const keyKind = decl.parameters[0]?.type?.kind;
		if (keyKind === ts.SyntaxKind.StringKeyword) kinds.add(ts.IndexKind.String);
		else if (keyKind === ts.SyntaxKind.NumberKeyword) kinds.add(ts.IndexKind.Number);
	}
	return kinds;
};

/**
 * The call and construct signature declarations an interface's computed
 * heritage contributes (`extractComputedHeritageMembers`).
 */
export interface ContributedSignatures {
	call: ReadonlySet<ts.Node>;
	construct: ReadonlySet<ts.Node>;
}

/**
 * Emit the members an interface gets from its computed heritage.
 *
 * An interface's `members` are its own, plus what each `extends` entry that
 * isn't a named interface or class contributes (`isNamedHeritageType`). A
 * named base has its own declaration, which `extends` names, so its members
 * stay there. A computed type has none: `interface A extends
 * z.infer<typeof S> {}`, the author-side fix for `alias_lost`, or
 * `interface A extends Omit<Base, 'b'> {}`, would otherwise document no member
 * reachable anywhere. Each computed entry contributes what the same type
 * documents as a type alias's members (`extractTypeAliasProperties`): its
 * properties through the same projection (`emitPropertyMembers`), filtered by
 * the same external-origin and visibility rules (`filterDocumentedProperties`;
 * the labels for what that drops come from `applyHeritageExternalTypes`,
 * which walks the same entries), then its local `string` and `number` index
 * signatures. So a computed type over a named interface (`Partial<Base>`,
 * `Pick<Base, 'a'>`, `Base & {c: C}`) lists the base's properties it keeps,
 * as the alias would, and a project type alias in `extends`, an object type
 * with no declaration of its own, contributes too, even when it is
 * documented itself.
 *
 * Which entry a name comes from follows TypeScript's inheritance: a name the
 * interface declares wins, then the first heritage entry, named or computed,
 * that has the name. The declared names are read from every merged block
 * (`symbol.members`), though only `node`'s block is documented (its members
 * by `extractTypeInfo`, its `extends` here): a name another block declares
 * drops from the contribution and documents nowhere, which is right where it
 * overrides the heritage's type, and the other block's members going
 * undocumented is a limitation of the one-block reading, not of this rule.
 * A name a named base supplies first stays that base's; one an external bag
 * supplies first is dropped. An index signature
 * likewise comes from the first entry with that key type, unless the
 * interface declares one. Contributed members follow the own ones, entry by
 * entry in heritage order, each type's properties in the checker's order,
 * then their index signatures. They carry no `sourceLine`, like every member.
 *
 * Call and construct signatures go by declaration the same way: the first
 * entry whose type has a signature declaration claims it, so one a named base
 * supplies first stays the base's even when a later computed entry reaches it
 * too (`extends Base, Base & {…}`), and each declaration is contributed once.
 * The caller emits them, since they join the own signatures as overloads of
 * one member (`extractTypeInfo`).
 *
 * @param heritageTypes - the processed declaration's own `extends` entries
 * @returns the signature declarations the computed entries contribute, local ones only
 * @mutates declaration - appends the contributed members (and `partial: true` on extraction failure)
 * @mutates ctx.diagnostics - adds `type_extraction_failed` on checker errors
 */
export const extractComputedHeritageMembers = (
	node: ts.InterfaceDeclaration,
	heritageTypes: ReadonlyArray<ts.ExpressionWithTypeArguments>,
	declaration: DeclarationJsonBuild,
	ctx: ExtractContext
): ContributedSignatures => {
	const { checker, isExternalFile } = ctx;
	const symbol = checker.getSymbolAtLocation(node.name);
	const claimed: Set<ts.__String> = new Set(symbol?.members?.keys() ?? []);
	const claimedIndexKinds = ownIndexKinds(symbol);
	const claimedSignatures: Set<ts.Node> = new Set();
	const contributed = { call: new Set<ts.Node>(), construct: new Set<ts.Node>() };
	const indexContributions: Array<{ entryType: ts.Type; entry: ts.Node; kind: ts.IndexKind }> = [];

	for (const entry of heritageTypes) {
		try {
			const entryType = checker.getTypeAtLocation(entry);
			const computed = !isNamedHeritageType(entryType);
			if (computed && hasExtractableProperties(entryType, isExternalFile)) {
				const { properties } = filterDocumentedProperties(
					entryType,
					entry,
					checker,
					isExternalFile
				);
				emitPropertyMembers(
					properties.filter((prop) => !claimed.has(prop.escapedName)),
					entryType,
					entry,
					declaration,
					ctx
				);
			}
			// claim every name the entry has, dropped ones included, so a later entry
			// can't supply what TypeScript took from this one
			for (const prop of entryType.getProperties()) claimed.add(prop.escapedName);
			for (const kind of [ts.IndexKind.String, ts.IndexKind.Number]) {
				if (claimedIndexKinds.has(kind) || !checker.getIndexInfoOfType(entryType, kind)) continue;
				claimedIndexKinds.add(kind);
				if (computed) indexContributions.push({ entryType, entry, kind });
			}
			for (const [kind, out] of [
				[ts.SignatureKind.Call, contributed.call],
				[ts.SignatureKind.Construct, contributed.construct]
			] as const) {
				for (const sig of checker.getSignaturesOfType(entryType, kind)) {
					const decl: ts.SignatureDeclaration | undefined = sig.getDeclaration();
					if (!decl || claimedSignatures.has(decl)) continue;
					claimedSignatures.add(decl);
					if (computed && !isExternalSignature(sig, isExternalFile)) out.add(decl);
				}
			}
		} catch (err) {
			declaration.partial = true;
			const loc = getNodeLocation(entry);
			ctx.diagnostics.push({
				kind: 'type_extraction_failed',
				file: loc.file,
				line: loc.line,
				column: loc.column,
				message: `Failed to extract members of "${entry.getText()}" for interface "${declaration.name}": ${toErrorMessage(err)}`,
				severity: 'warning',
				symbolName: declaration.name ?? '<default export>'
			});
		}
	}

	// after every entry's properties, as the alias path lists index signatures
	// after its properties
	for (const { entryType, entry, kind } of indexContributions) {
		emitLocalIndexSignature(
			declaration,
			entryType,
			entry,
			ctx,
			kind === ts.IndexKind.String ? 'string' : 'number'
		);
	}
	return contributed;
};

/**
 * Extract properties from a type alias via the TypeScript checker API.
 *
 * Handles object literals, intersections, mapped types (Partial, Pick, Readonly, etc.),
 * type references, and function types. Extracts:
 * - Named properties (with readonly/optional detection, TSDoc from declarations)
 * - Index signatures (string/number)
 * - Call signatures (`(call)`)
 * - Construct signatures (`(construct)`)
 *
 * A JSDoc typedef reads the same way: a `@typedef {object}` builds its
 * properties from `@property` tags (each tag's description is the member's
 * `docComment`, and a bracketed `[x]` or `{T=}` makes it optional), and a
 * `@callback` is a function type, so it gets a `(call)` member whose
 * parameters and return carry the callback's `@param`/`@returns` text.
 *
 * @mutates declaration - adds members
 */
export const extractTypeAliasProperties = (
	node: TypeAliasLike,
	nodeType: ts.Type,
	declaration: DeclarationJsonBuild,
	ctx: ExtractContext
): void => {
	if (!hasExtractableProperties(nodeType, ctx.isExternalFile)) return;
	const { checker, isExternalFile } = ctx;

	// Drop properties contributed by external types (node_modules / declaration
	// files) and surface those external types in the `externalTypes` field. Applies
	// to the property-bearing shapes that pass `hasExtractableProperties` above —
	// intersections, bare references, indexed-access. Unions are gated out here
	// (the Svelte prop path calls `filterDocumentedProperties` directly, so unions
	// still surface `externalTypes` there, just not for plain type aliases).
	const typeNode = typeAliasTypeNode(node);
	const { properties: filteredProperties, externalTypes } = filterDocumentedProperties(
		nodeType,
		typeNode ?? node,
		checker,
		isExternalFile
	);
	if (externalTypes.length) {
		declaration.externalTypes = externalTypes;
	}

	// Extract named properties (external contributions already filtered out)
	emitPropertyMembers(filteredProperties, nodeType, node, declaration, ctx);

	// Extract index signatures. For intersections, only emit signatures contributed
	// by local branches — external branches like `HTMLAttributes<HTMLDivElement>`
	// otherwise leak their string index signature onto the consuming type.
	emitLocalIndexSignature(declaration, nodeType, node, ctx, 'string');
	emitLocalIndexSignature(declaration, nodeType, node, ctx, 'number');

	// Extract call and construct signatures, dropping external contributions by
	// declaration origin like properties and index signatures — an external
	// branch's `(call)` belongs in `externalTypes`, not in `members`. TSDoc
	// resolves through the signature's own declaration — for type aliases,
	// that's typically the inline call/construct signature node the user wrote.
	const errorContext = { node, kindLabel: 'type' };
	const localOnly = (sigs: ReadonlyArray<ts.Signature>): ReadonlyArray<ts.Signature> =>
		sigs.filter((sig) => !isExternalSignature(sig, isExternalFile));

	emitCallOrConstructSignature(
		() => localOnly(nodeType.getCallSignatures()),
		'call',
		(sig) => sig.getDeclaration(),
		node,
		declaration,
		ctx,
		errorContext
	);

	emitCallOrConstructSignature(
		() => localOnly(nodeType.getConstructSignatures()),
		'construct',
		(sig) => sig.getDeclaration(),
		node,
		declaration,
		ctx,
		errorContext
	);
};
