/**
 * Per-declaration extractor for TypeScript classes.
 *
 * `extractClassInfo` mutates a `DeclarationJsonBuild` with rich metadata
 * derived from the class declaration: heritage clauses, generic parameters,
 * properties, methods, constructors, and accessor pairs (getters/setters
 * merged by name). Called by `analyzeDeclaration` in `typescript-exports.ts`
 * once kind dispatch is settled.
 *
 * @see `typescript-extract-shared.ts` for shared helpers
 *
 * @internal
 *
 * @module
 */

import ts from 'typescript';

import type { MemberKind, DeclarationModifier } from './types.ts';
import type { DeclarationJsonBuild, MemberJsonBuild } from './declaration-build.ts';
import { toErrorMessage } from './error.ts';
import {
	parseComment,
	applyToDeclaration,
	hasDocContent,
	jsdocOverloadSignatures,
	type TsdocParsedComment
} from './tsdoc.ts';
import {
	isJavaScriptNode,
	resolveTypeInfo,
	writtenGetterTypeNode,
	writtenTypeAnnotation
} from './typescript-extract-type-json.ts';
import {
	applyHeritageExternalTypes,
	detectReactivity,
	extractModifiers,
	getNodeLocation,
	getNonOptionalType,
	getTypeSignature,
	isPrivateMemberDeclaration,
	memberNameText,
	optionalWidened,
	parseGenericParam,
	populateCallableMember,
	signatureTypeParameters,
	type ExtractContext
} from './typescript-extract-shared.ts';

/**
 * Extract class information with rich member metadata. Decorators aren't
 * modeled.
 *
 * A JS class reads as the checker reads it, so it documents like its
 * TypeScript twin: JSDoc modifier tags through `extractModifiers` and
 * `isPrivateMemberDeclaration`, `@extends`/`@implements` tags as heritage
 * (`classExtendsType`, `classImplementsTypes`), and `this.x = …` assignments
 * as members (`collectThisAssignedMembers`).
 *
 * @internal Used by `analyzeDeclaration` — not part of the public barrel export.
 *
 * @param node - the declaration AST node
 * @param declaration - the declaration to populate
 * @param ctx - the extraction pass's context
 * @mutates declaration - adds extends, implements, genericParams, members
 */
export const extractClassInfo = (
	node: ts.Node,
	declaration: DeclarationJsonBuild,
	ctx: ExtractContext
): void => {
	if (!ts.isClassDeclaration(node)) return;
	const { checker, diagnostics } = ctx;

	const extendsType = classExtendsType(node);
	if (extendsType) {
		declaration.extends = [extendsType.getText()];
		// members are own-only, so external content inherited through the
		// extends chain is never enumerated — record its contributors like the
		// interface path does. `implements` adds no members and contributes
		// nothing here
		applyHeritageExternalTypes(declaration, [extendsType], ctx);
	}
	const implementsTypes = classImplementsTypes(node);
	if (implementsTypes.length) declaration.implements = implementsTypes.map((t) => t.getText());

	// the checker's reading, so a JS class's `@template` tags count like `<T>`
	const typeParameters = ts.getEffectiveTypeParameterDeclarations(node);
	if (typeParameters.length) {
		declaration.genericParams = typeParameters.map(parseGenericParam);
	}

	// Extract members with full metadata
	// Track processed constructors and methods to deduplicate overloads
	let constructorProcessed = false;
	const processedMethods: Set<string> = new Set();
	// JS `this.x = …` members, slotted in just ahead of the constructor, where
	// a TypeScript twin declares its fields, else after the written members
	let thisAssigned: Array<ThisAssignedMember> | null = collectThisAssignedMembers(node, checker);
	const pushThisAssigned = (): void => {
		for (const entry of thisAssigned ?? []) {
			(declaration.members ??= []).push(buildThisAssignedMember(entry, node, ctx));
		}
		thisAssigned = null;
	};

	for (const member of node.members) {
		if (ts.isConstructorDeclaration(member)) pushThisAssigned();
		if (
			ts.isPropertyDeclaration(member) ||
			ts.isMethodDeclaration(member) ||
			ts.isConstructorDeclaration(member)
		) {
			const isConstructor = ts.isConstructorDeclaration(member);
			// literal names unquoted like the structural paths; computed names keep
			// their written text (`[Symbol.iterator]`)
			const memberName = isConstructor
				? 'constructor'
				: (memberNameText(member.name) ?? member.name.getText());
			if (!memberName) continue;

			// `#` fields and `private` members are the class's own business —
			// protected stays, as part of the extension API
			if (isPrivateMemberDeclaration(member)) continue;

			// Skip duplicate overload declarations — only process first occurrence
			if (isConstructor) {
				if (constructorProcessed) continue;
				constructorProcessed = true;
			} else if (ts.isMethodDeclaration(member)) {
				if (processedMethods.has(memberName)) continue;
				processedMethods.add(memberName);
			}

			const memberKind: MemberKind = isConstructor
				? 'constructor'
				: ts.isMethodDeclaration(member)
					? 'function'
					: 'variable';

			const memberDeclaration: MemberJsonBuild = {
				name: memberName,
				kind: memberKind
			};

			if (
				(ts.isPropertyDeclaration(member) || ts.isMethodDeclaration(member)) &&
				member.questionToken
			) {
				memberDeclaration.optional = true;
			}

			const modifierFlags = extractModifiers(member);
			if (modifierFlags.length > 0) {
				memberDeclaration.modifiers = modifierFlags;
			}

			// Extract TSDoc (see `applyToDeclaration` for the fields it sets)
			const memberTsdoc = parseComment(member, node.getSourceFile());
			applyToDeclaration(memberDeclaration, memberTsdoc, true);

			// Extract type information and parameters for methods and constructors
			try {
				if (ts.isPropertyDeclaration(member)) {
					// Checker-backed for annotated and inferred fields alike; the
					// annotation feeds `typeInfo` name recovery, and the optional strip
					// pairs the widening with `optional` like every checker-backed site.
					const memberSymbol = checker.getSymbolAtLocation(member.name);
					if (memberSymbol) {
						const t = checker.getTypeOfSymbolAtLocation(memberSymbol, member);
						// `optionalWidened`: under `exactOptionalPropertyTypes` there's no
						// widening to strip and a written `| undefined` survives
						const widened = optionalWidened(ctx, !!member.questionToken);
						memberDeclaration.typeSignature = getTypeSignature(t, checker, widened);
						const typeInfo = resolveTypeInfo(t, checker, ctx.aliasRegistry, widened, {
							writtenNode: writtenTypeAnnotation(member)
						});
						if (typeInfo) memberDeclaration.typeInfo = typeInfo;
					}
				} else if (ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member)) {
					let signatures: ReadonlyArray<ts.Signature> = [];

					if (isConstructor) {
						// Direct AST→signature path. Mirrors how methods (below) operate via
						// the member node, but constructors lack a `member.name` to detour
						// through. Works for both named and anonymous classes (the previous
						// `getSymbolAtLocation(node.name)` detour silently dropped signatures
						// for `export default class { ... }`).
						const ctorDecls = node.members.filter(ts.isConstructorDeclaration);
						// When overload signatures (no body) exist, only those count as
						// public signatures — the implementation is hidden, and so is a
						// JS constructor's behind its `@overload` tags. Mirrors what
						// `getConstructSignatures()` returns on the class type.
						const overloadDecls = ctorDecls.filter((c) => !c.body);
						const ctorsToUse: Array<ts.ConstructorDeclaration | ts.JSDocSignature> =
							overloadDecls.length > 0
								? overloadDecls
								: ctorDecls.flatMap((c): Array<ts.ConstructorDeclaration | ts.JSDocSignature> => {
										const jsdocOverloads = jsdocOverloadSignatures(c);
										return jsdocOverloads.length > 0 ? jsdocOverloads : [c];
									});
						// the checker's `getSignatureFromDeclaration` takes a JSDoc
						// signature too, though its public signature doesn't name one
						signatures = ctorsToUse
							.map((c) => checker.getSignatureFromDeclaration(c as ts.SignatureDeclaration))
							.filter((s): s is ts.Signature => s !== undefined);
					} else {
						// For methods, get call signatures from the method symbol
						const memberSymbol = checker.getSymbolAtLocation(member.name);
						if (memberSymbol) {
							const memberType = checker.getTypeOfSymbolAtLocation(memberSymbol, member);
							// an optional method (`m?(): void {}`) resolves to a union with
							// `undefined`, which reports no call signatures — strip it before
							// asking, like the interface-method site. No `optionalWidened`
							// gate: method syntax can't write `| undefined`, so under
							// `exactOptionalPropertyTypes` this is identity
							const callableType = getNonOptionalType(memberType, checker, !!member.questionToken);
							signatures = callableType.getCallSignatures();
						}
					}

					populateCallableMember(
						memberDeclaration,
						signatures,
						ctx,
						memberTsdoc,
						member,
						memberName,
						!isConstructor
					);

					// a method's own generics, as on interface methods; an overloaded
					// method's are its first overload's, like a function's
					if (!isConstructor) {
						const typeParams = signatureTypeParameters(member);
						if (typeParams?.length) {
							memberDeclaration.genericParams = typeParams.map(parseGenericParam);
						}
					}
				}
			} catch (err) {
				memberDeclaration.partial = true;
				const loc = getNodeLocation(member);
				const className = node.name?.text ?? '<anonymous>';
				diagnostics.push({
					kind: 'class_member_failed',
					file: loc.file,
					line: loc.line,
					column: loc.column,
					message: `Failed to analyze member "${memberName}" in class "${className}": ${toErrorMessage(err)}`,
					severity: 'warning',
					className,
					memberName
				});
			}

			// Outside the try so reactivity is still captured if type extraction throws.
			if (ts.isPropertyDeclaration(member)) {
				const reactivity = detectReactivity(member.initializer);
				if (reactivity) memberDeclaration.reactivity = reactivity;
			}

			(declaration.members ??= []).push(memberDeclaration);
		}
	}

	pushThisAssigned();

	// Extract accessors (getters/setters) - group by name to merge pairs
	const accessors: Map<
		string,
		{ getter: ts.GetAccessorDeclaration | null; setter: ts.SetAccessorDeclaration | null }
	> = new Map();
	// a pair with either side private is dropped whole, as on a type alias over
	// the class, where the merged property is private when any declaration is
	// (`isPrivateProperty`)
	const privateAccessors: Set<string> = new Set();

	for (const member of node.members) {
		if (ts.isGetAccessor(member) || ts.isSetAccessor(member)) {
			const accessorName = memberNameText(member.name) ?? member.name.getText();
			if (!accessorName) continue;

			if (isPrivateMemberDeclaration(member)) {
				privateAccessors.add(accessorName);
				continue;
			}

			const existing = accessors.get(accessorName) ?? { getter: null, setter: null };
			if (ts.isGetAccessor(member)) {
				existing.getter = member;
			} else {
				existing.setter = member;
			}
			accessors.set(accessorName, existing);
		}
	}

	// Create declarations for accessor pairs
	for (const [accessorName, { getter, setter }] of accessors) {
		if (privateAccessors.has(accessorName)) continue;
		const accessorDeclaration: MemberJsonBuild = {
			name: accessorName,
			kind: 'variable'
		};

		// Build modifiers: getter/setter indicators + other modifiers (static, etc.)
		const accessorModifiers: Array<DeclarationModifier> = [];
		if (getter) accessorModifiers.push('getter');
		if (setter) accessorModifiers.push('setter');

		// Extract other modifiers from getter (or setter if no getter)
		const primaryAccessor = getter ?? setter!;
		const otherModifiers = extractModifiers(primaryAccessor);
		accessorModifiers.push(...otherModifiers);

		if (accessorModifiers.length > 0) {
			accessorDeclaration.modifiers = accessorModifiers;
		}

		// Extract TSDoc - prefer getter's, fall back to setter's
		const getterTsdoc = getter ? parseComment(getter, node.getSourceFile()) : undefined;
		const setterTsdoc = setter ? parseComment(setter, node.getSourceFile()) : undefined;
		const accessorTsdoc = getterTsdoc ?? setterTsdoc;
		applyToDeclaration(accessorDeclaration, accessorTsdoc, true);

		// Extract type signature from getter's return type
		try {
			if (getter) {
				const getterSymbol = checker.getSymbolAtLocation(getter.name);
				if (getterSymbol) {
					const getterType = checker.getTypeOfSymbolAtLocation(getterSymbol, getter);
					accessorDeclaration.typeSignature = checker.typeToString(getterType);
					const typeInfo = resolveTypeInfo(getterType, checker, ctx.aliasRegistry, false, {
						writtenNode: writtenGetterTypeNode(getter)
					});
					if (typeInfo) accessorDeclaration.typeInfo = typeInfo;
				}
			} else if (setter) {
				// Setter-only: the accessor symbol's type is the setter's parameter
				// type — checker-backed like the getter path, with the written
				// parameter annotation feeding `typeInfo` name recovery
				const setterSymbol = checker.getSymbolAtLocation(setter.name);
				if (setterSymbol) {
					const setterType = checker.getTypeOfSymbolAtLocation(setterSymbol, setter);
					accessorDeclaration.typeSignature = checker.typeToString(setterType);
					const typeInfo = resolveTypeInfo(setterType, checker, ctx.aliasRegistry, false, {
						writtenNode: setter.parameters[0] && writtenTypeAnnotation(setter.parameters[0])
					});
					if (typeInfo) accessorDeclaration.typeInfo = typeInfo;
				}
			}
		} catch (err) {
			accessorDeclaration.partial = true;
			const loc = getNodeLocation(primaryAccessor);
			const className = node.name?.text ?? '<anonymous>';
			diagnostics.push({
				kind: 'class_member_failed',
				file: loc.file,
				line: loc.line,
				column: loc.column,
				message: `Failed to analyze accessor "${accessorName}" in class "${className}": ${toErrorMessage(err)}`,
				severity: 'warning',
				className,
				memberName: accessorName
			});
		}

		(declaration.members ??= []).push(accessorDeclaration);
	}
};

/**
 * A JS class member that only `this.x = …` assignments declare.
 */
interface ThisAssignedMember {
	symbol: ts.Symbol;
	/**
	 * The assignment that places the member (order, `reactivity`, a failure's
	 * location): its first in the constructor, else its first.
	 */
	primary: ts.BinaryExpression;
	/**
	 * The assignment whose JSDoc modifier tags the member carries: the
	 * checker's own declaration of the property (its `valueDeclaration`, the
	 * first assignment in source order), else the constructor's first
	 * assignment, else the first.
	 */
	modified: ts.BinaryExpression;
	/**
	 * The `@type` the checker types the member by, the first one across the
	 * symbol's assignments in source order, for `typeInfo` name recovery.
	 */
	writtenNode: ts.TypeNode | undefined;
	/** The member's docs (`collectThisAssignedMembers`). */
	tsdoc: TsdocParsedComment | undefined;
	/** Assigned in a static method or block, so a member of the class itself. */
	isStatic: boolean;
}

/**
 * The members a JS class declares by assignment alone, the checker's
 * reading: each `this.x = …` (or `this['x'] = …`) in the constructor, a
 * method, an accessor, or an arrow within one declares a property, a static
 * one in a static method or block. They document like the field a
 * TypeScript twin writes (`x: T`): `kind: 'variable'`, typed by the checker
 * across every assignment (the first `@type` in source order, else a
 * constructor's assignments taking precedence), with that `@type` as the
 * written node for `typeInfo`. Modifiers (`@readonly`, `@protected`) are
 * the ones the checker enforces, from the JSDoc of the property's
 * declaration, its first assignment in source order, so a method written
 * above the constructor can supply them. Docs come from the first documented
 * assignment in the constructor (a static block, for a static), else the
 * first documented one anywhere.
 * Hover joins every assignment's prose instead; one block keeps `docComment`
 * a single author statement.
 *
 * A name the class also writes as a member is that member's alone, listed
 * once by the written member. The checker binds no assignment declaration over
 * a member written above it, but an assignment bound before the member (a
 * method, constructor, or static block written above a field) stays one of the
 * symbol's declarations, so a symbol with a written member of this class is
 * skipped.
 * A `@private` on the assignment that supplies the modifiers hides the
 * member, as the checker enforces it and as `private` hides a field
 * (`isPrivateMemberDeclaration`); `this.#x` needs a written `#x` field, so
 * it's already out. Expando assignments outside the class
 * (`A.prototype.x = …`, `A.x = …`) declare nothing here, nor does a
 * non-literal key (`this[k] = …`, the checker's `__computed`).
 *
 * An inherited name (a property the base type declares, not the global
 * `Object`'s or `Function`'s) assigned without a written member stays the
 * base's (`this.name = …` in an `Error` subclass lists nothing), as in a
 * TypeScript twin that assigns it without redeclaring. To document it on the
 * subclass, write a field. This is the twin's reading, not the checker's,
 * which takes an undocumented constructor assignment of an inherited name as
 * the class's own property; one rule keeps the class and a type alias over
 * it agreeing.
 *
 * Order: those the constructor assigns first, each group in source order of
 * its primary assignment. `extractClassInfo` slots them in just ahead of the
 * constructor, where a TypeScript twin declares its fields (a class without
 * one lists them after its written fields and methods, before accessors).
 */
const collectThisAssignedMembers = (
	node: ts.ClassDeclaration,
	checker: ts.TypeChecker
): Array<ThisAssignedMember> => {
	if (!isJavaScriptNode(node)) return [];
	const classSymbol = checker.getTypeAtLocation(node).getSymbol();
	if (!classSymbol) return [];
	const sourceFile = node.getSourceFile();
	const instanceType = checker.getDeclaredTypeOfSymbol(classSymbol);
	const staticType = checker.getTypeOfSymbol(classSymbol);
	// the bases' own properties: `getPropertyOfType` would add the global
	// `Object`'s and `Function`'s, which a base-less class lists as its own
	const propertyNames = (types: ReadonlyArray<ts.Type>): Set<ts.__String> =>
		new Set(types.flatMap((t) => checker.getPropertiesOfType(t).map((p) => p.escapedName)));
	const inheritedInstanceNames = propertyNames(
		instanceType.isClassOrInterface() ? checker.getBaseTypes(instanceType) : []
	);
	const extendsExpression = node.heritageClauses?.find(
		(hc) => hc.token === ts.SyntaxKind.ExtendsKeyword
	)?.types[0]?.expression;
	const inheritedStaticNames = propertyNames(
		extendsExpression ? [checker.getTypeAtLocation(extendsExpression)] : []
	);
	const documented = (a: ts.BinaryExpression): TsdocParsedComment | undefined => {
		const parsed = parseComment(a, sourceFile);
		return parsed && hasDocContent(parsed) ? parsed : undefined;
	};
	const found: Array<ThisAssignedMember & { inConstructor: boolean }> = [];
	const collect = (table: ts.SymbolTable | undefined, isStatic: boolean): void => {
		table?.forEach((symbol) => {
			const decls = symbol.getDeclarations() ?? [];
			const assignments = decls.filter(
				(d): d is ts.BinaryExpression => ts.isBinaryExpression(d) && isThisAssignmentIn(d, node)
			);
			if (!assignments.length) return;
			// the written member lists it, even when an assignment above it bound first
			if (decls.some((d) => ts.isClassElement(d) && d.parent === node)) return;
			// an inherited name is the base's property
			if ((isStatic ? inheritedStaticNames : inheritedInstanceNames).has(symbol.escapedName)) {
				return;
			}
			const inConstructor = assignments.filter((a) => isInConstructorOf(a, node));
			// where docs are looked for first: the constructor, or for a static a static block
			const preferredDocSites = isStatic
				? assignments.filter((a) => isInStaticBlockOf(a, node))
				: inConstructor;
			const resolved = checker.getPropertyOfType(
				isStatic ? staticType : instanceType,
				symbol.getName()
			);
			// the checker's own declaration, when it reads the property as the class's
			const checkerDeclared = assignments.find((a) => a === resolved?.valueDeclaration);
			// the checker's own property, so a non-literal key (`this[k] = …`, its
			// `__computed`) and anything it reads as another declaration's drop
			const resolvedDecls = resolved?.getDeclarations();
			if (!assignments.some((a) => resolvedDecls?.includes(a))) return;
			const modified = checkerDeclared ?? inConstructor[0] ?? assignments[0]!;
			// hidden by the declaration the checker enforces, as modifiers are read
			if (isPrivateMemberDeclaration(modified)) return;
			const primary = inConstructor[0] ?? assignments[0]!;
			let tsdoc: TsdocParsedComment | undefined;
			for (const a of [...preferredDocSites, ...assignments]) {
				if ((tsdoc = documented(a))) break;
			}
			found.push({
				symbol,
				primary,
				modified,
				writtenNode: firstWrittenType(decls),
				tsdoc,
				isStatic,
				inConstructor: inConstructor.length > 0
			});
		});
	};
	collect(classSymbol.members, false);
	collect(classSymbol.exports, true);
	return found
		.sort(
			(a, b) => Number(b.inConstructor) - Number(a.inConstructor) || a.primary.pos - b.primary.pos
		)
		.map(({ inConstructor: _, ...member }) => member);
};

/**
 * Build the member a `this.x = …` assignment declares (`collectThisAssignedMembers`).
 */
const buildThisAssignedMember = (
	{ symbol, primary, modified, writtenNode, tsdoc, isStatic }: ThisAssignedMember,
	node: ts.ClassDeclaration,
	ctx: ExtractContext
): MemberJsonBuild => {
	const { checker, diagnostics } = ctx;
	const memberName = symbol.getName();
	const memberDeclaration: MemberJsonBuild = { name: memberName, kind: 'variable' };
	const modifiers = extractModifiers(
		modified,
		isStatic ? ts.ModifierFlags.Static : ts.ModifierFlags.None
	);
	if (modifiers.length > 0) memberDeclaration.modifiers = modifiers;

	applyToDeclaration(memberDeclaration, tsdoc, true);

	try {
		// the checker's reading across every assignment (the first `@type`, else
		// a constructor's win), that `@type` feeding `typeInfo` name recovery
		const t = checker.getTypeOfSymbolAtLocation(symbol, node);
		memberDeclaration.typeSignature = getTypeSignature(t, checker, false);
		const typeInfo = resolveTypeInfo(t, checker, ctx.aliasRegistry, false, { writtenNode });
		if (typeInfo) memberDeclaration.typeInfo = typeInfo;
	} catch (err) {
		memberDeclaration.partial = true;
		const loc = getNodeLocation(primary);
		const className = node.name?.text ?? '<anonymous>';
		diagnostics.push({
			kind: 'class_member_failed',
			file: loc.file,
			line: loc.line,
			column: loc.column,
			message: `Failed to analyze member "${memberName}" in class "${className}": ${toErrorMessage(err)}`,
			severity: 'warning',
			className,
			memberName
		});
	}

	const reactivity = detectReactivity(primary.right);
	if (reactivity) memberDeclaration.reactivity = reactivity;

	return memberDeclaration;
};

/**
 * The `@type` the checker types an assignment-declared symbol by: the first
 * annotated declaration's, in declaration (source) order, a later one only
 * checked against it.
 */
const firstWrittenType = (decls: ReadonlyArray<ts.Declaration>): ts.TypeNode | undefined => {
	for (const d of decls) {
		const expr = ts.isBinaryExpression(d)
			? d
			: (ts.isPropertyAccessExpression(d) || ts.isElementAccessExpression(d)) &&
				  ts.isBinaryExpression(d.parent)
				? d.parent
				: undefined;
		const typeNode = expr && ts.getJSDocType(expr);
		if (typeNode) return typeNode;
	}
	return undefined;
};

/** Whether `expr` is a `this.x = …` or `this['x'] = …` assignment inside `node`. */
const isThisAssignmentIn = (expr: ts.BinaryExpression, node: ts.ClassDeclaration): boolean => {
	const { left } = expr;
	return (
		(ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left)) &&
		left.expression.kind === ts.SyntaxKind.ThisKeyword &&
		expr.pos >= node.pos &&
		expr.end <= node.end
	);
};

/** Whether `expr` sits in one of `node`'s static blocks (arrows included, as `this` is the class). */
const isInStaticBlockOf = (expr: ts.Node, node: ts.ClassDeclaration): boolean => {
	for (let n = expr.parent; n !== node; n = n.parent) {
		if (ts.isClassStaticBlockDeclaration(n)) return n.parent === node;
	}
	return false;
};

/** Whether `expr` sits in `node`'s constructor (arrows included, as `this` is the instance). */
const isInConstructorOf = (expr: ts.Node, node: ts.ClassDeclaration): boolean => {
	for (let n = expr.parent; n !== node; n = n.parent) {
		if (ts.isConstructorDeclaration(n)) return n.parent === node;
	}
	return false;
};

/**
 * A class's `extends` entry, the checker's reading: the clause's type, or in
 * JS the `@extends {Base<T>}` (`@augments`) tag's beside a clause, so
 * its type arguments show as a TypeScript `extends Base<T>` writes them. A
 * tag without a clause extends nothing, as for the checker.
 */
const classExtendsType = (
	node: ts.ClassDeclaration
): ts.ExpressionWithTypeArguments | undefined => {
	const clauseType = node.heritageClauses?.find((hc) => hc.token === ts.SyntaxKind.ExtendsKeyword)
		?.types[0];
	if (!clauseType || !isJavaScriptNode(node)) return clauseType;
	return ts.getJSDocAugmentsTag(node)?.class ?? clauseType;
};

/**
 * A class's `implements` entries: the clause's types, or in JS the
 * `@implements {A}` tags', which the checker reads there only.
 */
const classImplementsTypes = (
	node: ts.ClassDeclaration
): ReadonlyArray<ts.ExpressionWithTypeArguments> => {
	const clauseTypes = (node.heritageClauses ?? [])
		.filter((hc) => hc.token === ts.SyntaxKind.ImplementsKeyword)
		.flatMap((hc) => hc.types);
	if (!isJavaScriptNode(node)) return clauseTypes;
	return [...clauseTypes, ...ts.getJSDocImplementsTags(node).map((tag) => tag.class)];
};
