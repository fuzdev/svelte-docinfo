/**
 * Property extraction for TypeScript type aliases.
 *
 * `extractTypeAliasProperties` walks the resolved type and emits members for
 * named properties, index signatures, call signatures, and construct
 * signatures. Handles object literals, intersections, mapped types
 * (Partial, Pick, Readonly, etc.), type references, and function types.
 * Called by `extractTypeInfo` in `typescript-extract-type.ts` for type
 * aliases (interfaces use a different path that walks `node.members`
 * directly).
 *
 * @see `typescript-extract-shared.ts` for shared helpers
 * @see `typescript-extract-type.ts` for the dispatcher
 *
 * @module
 */

import ts from 'typescript';

import type { DeclarationModifier } from './types.ts';
import type { DeclarationJsonBuild, MemberJsonBuild } from './declaration-build.ts';
import { to_error_message } from './error.ts';
import { parseComment } from './tsdoc.ts';
import { resolveTypeInfo } from './typescript-extract-type-json.ts';
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
 * Resolve, emit, and diagnose a local index signature for a type alias.
 *
 * Wraps `extractLocalIndexType` with the boilerplate shared by string and
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
	node: ts.TypeAliasDeclaration,
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
			message: `Failed to extract ${kind} index signature for type "${declaration.name ?? '<default export>'}": ${to_error_message(err)}`,
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
			if (ts.canHaveModifiers(decl)) {
				const mods = ts.getModifiers(decl);
				if (mods?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword)) return true;
			}
		}
	}
	return mappedReadonly;
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
 * @mutates declaration - adds members
 */
export const extractTypeAliasProperties = (
	node: ts.TypeAliasDeclaration,
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
	const { properties: filteredProperties, externalTypes } = filterDocumentedProperties(
		nodeType,
		node.type,
		checker,
		isExternalFile
	);
	if (externalTypes.length) {
		declaration.externalTypes = externalTypes;
	}

	// Detect mapped-type-level readonly (e.g., Readonly<T>, { readonly [K in ...]: ... })
	let mappedReadonly = false;
	if (
		nodeType.flags & ts.TypeFlags.Object &&
		(nodeType as ts.ObjectType).objectFlags & ts.ObjectFlags.Mapped
	) {
		// ts.MappedType is not in the public API, but the `declaration` property
		// exists at runtime on mapped types and holds the MappedTypeNode AST node
		const mappedDecl = (nodeType as ts.ObjectType & { declaration?: ts.MappedTypeNode })
			.declaration;
		if (mappedDecl?.readonlyToken) {
			mappedReadonly = true;
		}
	}

	// Extract named properties (external contributions already filtered out)
	for (const prop of filteredProperties) {
		// Skip internal TypeScript symbols
		if (prop.getName().startsWith('__@')) continue;

		const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
		const readonly = isReadonlyProperty(prop, mappedReadonly);

		let propType: ts.Type;
		try {
			propType = checker.getTypeOfSymbolAtLocation(prop, node);
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
			propDecl && (ts.isPropertySignature(propDecl) || ts.isPropertyDeclaration(propDecl))
				? propDecl.type
				: undefined;
		// owns the TSDoc application too — `@default` gates on the settled kind
		populatePropertyMember(
			member,
			propType,
			ctx,
			optional,
			propTsdoc,
			propDecl ?? node,
			prop.getName(),
			annotation
		);

		(declaration.members ??= []).push(member);
	}

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
