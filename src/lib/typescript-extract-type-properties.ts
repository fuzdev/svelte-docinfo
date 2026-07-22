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

import type { MemberKind, DeclarationModifier } from './types.ts';
import type { DeclarationJsonBuild, MemberJsonBuild } from './declaration-build.ts';
import { type Diagnostic } from './diagnostics.ts';
import { to_error_message } from './error.ts';
import { parseComment, applyToDeclaration, type TsdocParsedComment } from './tsdoc.ts';
import { type IsExternalFile } from './typescript-program.ts';
import {
	emitCallOrConstructSignature,
	filterExternalProperties,
	getNodeLocation,
	isExternalIntersectionBranch,
	populateCallableMember,
	resolveIntersectionTypeNode
} from './typescript-extract-shared.ts';

/**
 * Check whether a resolved type has properties worth extracting for documentation.
 *
 * Returns `true` for object-like types (object literals, intersections, mapped types,
 * type references, function types). Returns `false` for types where `getProperties()`
 * would return prototype methods or ambiguous results (unions, primitives, tuples,
 * generic type references like `Array<T>`).
 */
const hasExtractableProperties = (type: ts.Type): boolean => {
	// Intersections: checker merges properties from all branches
	if (type.isIntersection()) return true;

	// Unions: ambiguous property set (different branches have different shapes)
	if (type.isUnion()) return false;

	// Must be an object type
	if (!(type.flags & ts.TypeFlags.Object)) return false;

	const objFlags = (type as ts.ObjectType).objectFlags;

	// Tuples give array prototype methods — not useful
	if (objFlags & ts.ObjectFlags.Tuple) return false;

	// Generic type references (Array<T>, Promise<T>, Set<T>) give prototype methods.
	// Mapped types can also have Reference when instantiated (Partial<T>, Pick<T,K>),
	// so allow Reference when Mapped is also set.
	if (objFlags & ts.ObjectFlags.Reference && !(objFlags & ts.ObjectFlags.Mapped)) return false;

	return true;
};

/**
 * Get the index type for a type, filtering out external branches in intersections.
 *
 * For non-intersection types, this delegates to `checker.getIndexTypeOfType`.
 * For intersections, it walks each branch and returns the index type from the
 * first local branch (skipping branches whose declarations are all in external
 * files). Without this filtering, `getIndexTypeOfType` on the merged type would
 * surface index signatures contributed only by external branches like
 * `HTMLAttributes<HTMLDivElement>`, which is wrong for a library's own type.
 *
 * The "first local branch" simplification is conservative: multiple local
 * branches contributing index signatures of the same kind would normally be
 * intersected by the checker, but the merged result can also pull in external
 * contributions through inheritance — so we prefer the simpler local path. This
 * case is exceedingly rare in practice.
 */
const extractLocalIndexType = (
	nodeType: ts.Type,
	typeNode: ts.Node,
	checker: ts.TypeChecker,
	isExternalFile: IsExternalFile,
	indexKind: ts.IndexKind
): ts.Type | undefined => {
	if (!nodeType.isIntersection()) {
		return checker.getIndexTypeOfType(nodeType, indexKind);
	}

	const intersectionNode = resolveIntersectionTypeNode(nodeType, typeNode);
	if (!intersectionNode) {
		// Cannot determine branches — fall back to merged type. Conservative:
		// preserves prior behavior for the rare synthesized-intersection case.
		return checker.getIndexTypeOfType(nodeType, indexKind);
	}

	for (const branch of intersectionNode.types) {
		if (isExternalIntersectionBranch(branch, checker, isExternalFile)) continue;
		const branchType = checker.getTypeAtLocation(branch);
		const branchIndex = checker.getIndexTypeOfType(branchType, indexKind);
		if (branchIndex) return branchIndex;
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
	checker: ts.TypeChecker,
	diagnostics: Array<Diagnostic>,
	isExternalFile: IsExternalFile,
	kind: 'string' | 'number'
): void => {
	const indexKind = kind === 'string' ? ts.IndexKind.String : ts.IndexKind.Number;
	try {
		const indexType = extractLocalIndexType(
			nodeType,
			node.type,
			checker,
			isExternalFile,
			indexKind
		);
		if (indexType) {
			(declaration.members ??= []).push({
				name: `[key: ${kind}]`,
				kind: 'variable',
				typeSignature: checker.typeToString(indexType)
			});
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
	checker: ts.TypeChecker,
	declaration: DeclarationJsonBuild,
	diagnostics: Array<Diagnostic>,
	isExternalFile: IsExternalFile
): void => {
	if (!hasExtractableProperties(nodeType)) return;

	// Drop properties contributed by external types (node_modules / declaration
	// files) and surface those external types in the `intersects` field. Applies
	// to the property-bearing shapes that pass `hasExtractableProperties` above —
	// intersections, bare references, indexed-access. Unions are gated out here
	// (the Svelte prop path calls `filterExternalProperties` directly, so unions
	// still surface `intersects` there, just not for plain type aliases).
	const { properties: filteredProperties, externalTypes } = filterExternalProperties(
		nodeType,
		node.type,
		checker,
		isExternalFile
	);
	if (externalTypes.length) {
		declaration.intersects = externalTypes;
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

		// Determine kind: function (has call signatures) vs variable (property)
		let propType: ts.Type;
		try {
			propType = checker.getTypeOfSymbolAtLocation(prop, node);
		} catch {
			continue;
		}

		const callSigs = propType.getCallSignatures();
		const kind: MemberKind = callSigs.length > 0 ? 'function' : 'variable';

		const member: MemberJsonBuild = {
			name: prop.getName(),
			kind
		};

		if (optional) member.optional = true;

		// Modifiers
		const modifiers: Array<DeclarationModifier> = [];
		if (readonly) modifiers.push('readonly');
		if (modifiers.length > 0) member.modifiers = modifiers;

		// Extract TSDoc from the property's declaration if available
		const decls = prop.getDeclarations();
		let propTsdoc: TsdocParsedComment | undefined = undefined;
		if (decls && decls.length > 0) {
			propTsdoc = parseComment(decls[0]!, decls[0]!.getSourceFile());
			applyToDeclaration(member, propTsdoc);
		}

		// Type signature and function-specific fields
		if (kind === 'function' && callSigs.length > 0) {
			populateCallableMember(
				member,
				callSigs,
				checker,
				propTsdoc,
				decls?.[0] ?? node,
				prop.getName(),
				diagnostics
			);
		} else {
			member.typeSignature = checker.typeToString(propType);
			if (optional) {
				// Strip trailing " | undefined" that the checker adds for optional props
				member.typeSignature = checker.typeToString(checker.getNonNullableType(propType));
			}
		}

		(declaration.members ??= []).push(member);
	}

	// Extract index signatures. For intersections, only emit signatures contributed
	// by local branches — external branches like `HTMLAttributes<HTMLDivElement>`
	// otherwise leak their string index signature onto the consuming type.
	emitLocalIndexSignature(
		declaration,
		nodeType,
		node,
		checker,
		diagnostics,
		isExternalFile,
		'string'
	);
	emitLocalIndexSignature(
		declaration,
		nodeType,
		node,
		checker,
		diagnostics,
		isExternalFile,
		'number'
	);

	// Extract call and construct signatures. TSDoc resolves through the
	// signature's own declaration — for type aliases, that's typically the
	// inline call/construct signature node the user wrote.
	const errorContext = { node, kindLabel: 'type' };

	emitCallOrConstructSignature(
		() => nodeType.getCallSignatures(),
		'call',
		(sig) => sig.getDeclaration(),
		node,
		declaration,
		checker,
		diagnostics,
		errorContext
	);

	emitCallOrConstructSignature(
		() => nodeType.getConstructSignatures(),
		'construct',
		(sig) => sig.getDeclaration(),
		node,
		declaration,
		checker,
		diagnostics,
		errorContext
	);
};
