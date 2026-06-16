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
 * @module
 */

import ts from 'typescript';

import type {MemberKind, DeclarationModifier} from './types.ts';
import type {DeclarationJsonBuild, MemberJsonBuild} from './declaration-build.ts';
import {type Diagnostic} from './diagnostics.ts';
import {to_error_message} from './error.ts';
import {parseComment, applyToDeclaration} from './tsdoc.ts';
import {
	detectReactivity,
	extractModifiers,
	getNodeLocation,
	parseGenericParam,
	populateCallableMember,
} from './typescript-extract-shared.ts';

/**
 * Extract class information with rich member metadata.
 *
 * @internal Used by `analyzeDeclaration` — not part of the public barrel export.
 *
 * @param node - the declaration AST node
 * @param checker - TypeScript type checker
 * @param declaration - the declaration to populate
 * @param diagnostics - diagnostics collector for non-fatal issues
 * @mutates declaration - adds extends, implements, genericParams, members
 */
export const extractClassInfo = (
	node: ts.Node,
	checker: ts.TypeChecker,
	declaration: DeclarationJsonBuild,
	diagnostics: Array<Diagnostic>,
): void => {
	if (!ts.isClassDeclaration(node)) return;

	if (node.heritageClauses) {
		const extendsClause = node.heritageClauses.find(
			(hc) => hc.token === ts.SyntaxKind.ExtendsKeyword,
		);
		if (extendsClause?.types[0]) {
			declaration.extends = extendsClause.types[0].getText();
		}

		declaration.implements = node.heritageClauses
			.filter((hc) => hc.token === ts.SyntaxKind.ImplementsKeyword)
			.flatMap((hc) => hc.types.map((t) => t.getText()));
	}

	if (node.typeParameters?.length) {
		declaration.genericParams = node.typeParameters.map(parseGenericParam);
	}

	// Extract members with full metadata
	// Track processed constructors and methods to deduplicate overloads
	let constructorProcessed = false;
	const processedMethods: Set<string> = new Set();

	for (const member of node.members) {
		if (
			ts.isPropertyDeclaration(member) ||
			ts.isMethodDeclaration(member) ||
			ts.isConstructorDeclaration(member)
		) {
			const isConstructor = ts.isConstructorDeclaration(member);
			const memberName = isConstructor
				? 'constructor'
				: ts.isIdentifier(member.name)
					? member.name.text
					: member.name.getText();
			if (!memberName) continue;

			// Skip private fields (those starting with #)
			if (memberName.startsWith('#')) continue;

			// Skip private members - protected members are part of the extension API
			const modifiers = ts.getModifiers(member);
			if (modifiers) {
				const isPrivate = modifiers.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword);
				if (isPrivate) continue;
			}

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
				kind: memberKind,
			};

			if (ts.isPropertyDeclaration(member) && member.questionToken) {
				memberDeclaration.optional = true;
			}

			// Extract modifiers (reuse already-extracted modifiers array)
			const modifierFlags = extractModifiers(modifiers);
			if (modifierFlags.length > 0) {
				memberDeclaration.modifiers = modifierFlags;
			}

			// Extract TSDoc (applies docComment, examples, deprecated, seeAlso, since, mutates)
			const memberTsdoc = parseComment(member, node.getSourceFile());
			applyToDeclaration(memberDeclaration, memberTsdoc);

			// Extract type information and parameters for methods and constructors
			try {
				if (ts.isPropertyDeclaration(member)) {
					if (member.type) {
						memberDeclaration.typeSignature = member.type.getText();
					} else {
						// Fall back to inferred type for unannotated fields (e.g., `count = $state(0)`).
						const memberSymbol = checker.getSymbolAtLocation(member.name);
						if (memberSymbol) {
							const t = checker.getTypeOfSymbolAtLocation(memberSymbol, member);
							memberDeclaration.typeSignature = checker.typeToString(t);
						}
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
						// public signatures — the implementation is hidden. Mirrors what
						// `getConstructSignatures()` returns on the class type.
						const overloadDecls = ctorDecls.filter((c) => !c.body);
						const ctorsToUse = overloadDecls.length > 0 ? overloadDecls : ctorDecls;
						signatures = ctorsToUse
							.map((c) => checker.getSignatureFromDeclaration(c))
							.filter((s): s is ts.Signature => s !== undefined);
					} else {
						// For methods, get call signatures from the method symbol
						const memberSymbol = checker.getSymbolAtLocation(member.name);
						if (memberSymbol) {
							const memberType = checker.getTypeOfSymbolAtLocation(memberSymbol, member);
							signatures = memberType.getCallSignatures();
						}
					}

					populateCallableMember(
						memberDeclaration,
						signatures,
						checker,
						memberTsdoc,
						member,
						memberName,
						diagnostics,
						!isConstructor,
					);
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
					message: `Failed to analyze member "${memberName}" in class "${className}": ${to_error_message(err)}`,
					severity: 'warning',
					className,
					memberName,
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

	// Extract accessors (getters/setters) - group by name to merge pairs
	const accessors: Map<
		string,
		{getter: ts.GetAccessorDeclaration | null; setter: ts.SetAccessorDeclaration | null}
	> = new Map();

	for (const member of node.members) {
		if (ts.isGetAccessor(member) || ts.isSetAccessor(member)) {
			const accessorName = ts.isIdentifier(member.name) ? member.name.text : member.name.getText();
			if (!accessorName) continue;

			// Skip private accessors - protected are part of the extension API
			const modifiers = ts.getModifiers(member);
			if (modifiers) {
				const isPrivate = modifiers.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword);
				if (isPrivate) continue;
			}

			const existing = accessors.get(accessorName) ?? {getter: null, setter: null};
			if (ts.isGetAccessor(member)) {
				existing.getter = member;
			} else {
				existing.setter = member;
			}
			accessors.set(accessorName, existing);
		}
	}

	// Create declarations for accessor pairs
	for (const [accessorName, {getter, setter}] of accessors) {
		const accessorDeclaration: MemberJsonBuild = {
			name: accessorName,
			kind: 'variable',
		};

		// Build modifiers: getter/setter indicators + other modifiers (static, etc.)
		const accessorModifiers: Array<DeclarationModifier> = [];
		if (getter) accessorModifiers.push('getter');
		if (setter) accessorModifiers.push('setter');

		// Extract other modifiers from getter (or setter if no getter)
		const primaryAccessor = getter ?? setter!;
		const otherModifiers = extractModifiers(ts.getModifiers(primaryAccessor));
		accessorModifiers.push(...otherModifiers);

		if (accessorModifiers.length > 0) {
			accessorDeclaration.modifiers = accessorModifiers;
		}

		// Extract TSDoc - prefer getter's, fall back to setter's
		const getterTsdoc = getter ? parseComment(getter, node.getSourceFile()) : undefined;
		const setterTsdoc = setter ? parseComment(setter, node.getSourceFile()) : undefined;
		const accessorTsdoc = getterTsdoc ?? setterTsdoc;
		applyToDeclaration(accessorDeclaration, accessorTsdoc);

		// Extract type signature from getter's return type
		try {
			if (getter) {
				const getterSymbol = checker.getSymbolAtLocation(getter.name);
				if (getterSymbol) {
					const getterType = checker.getTypeOfSymbolAtLocation(getterSymbol, getter);
					accessorDeclaration.typeSignature = checker.typeToString(getterType);
				}
			} else if (setter?.parameters.length) {
				// Fall back to setter's parameter type if no getter
				const param = setter.parameters[0]!;
				if (param.type) {
					accessorDeclaration.typeSignature = param.type.getText();
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
				message: `Failed to analyze accessor "${accessorName}" in class "${className}": ${to_error_message(err)}`,
				severity: 'warning',
				className,
				memberName: accessorName,
			});
		}

		(declaration.members ??= []).push(accessorDeclaration);
	}
};
