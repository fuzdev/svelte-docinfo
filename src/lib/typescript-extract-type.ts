/**
 * Per-declaration extractors for TypeScript type aliases, interfaces, and enums.
 *
 * `extractTypeInfo` handles type aliases and interfaces (including index/method/
 * call/construct signatures and intersection filtering). `extractEnumInfo`
 * handles regular and const enums. Both mutate a `DeclarationJsonBuild` with
 * rich metadata derived from the TypeScript checker. Called by
 * `analyzeDeclaration` in `typescript-exports.ts` once kind dispatch is
 * settled.
 *
 * Type-alias property walking (named properties, index/call/construct
 * signatures) lives in `typescript-extract-type-properties.ts` to keep this
 * module focused on top-level dispatch.
 *
 * @see `typescript-extract-shared.ts` for shared helpers
 * @see `typescript-extract-type-properties.ts` for type-alias property walking
 *
 * @module
 */

import ts from 'typescript';

import type { DeclarationJsonBuild, MemberJsonBuild } from './declaration-build.ts';
import { to_error_message } from './error.ts';
import { parseComment, applyToDeclaration } from './tsdoc.ts';
import {
	emitCallOrConstructSignature,
	extractModifiers,
	getNodeLocation,
	getNonOptionalType,
	memberNameText,
	parseGenericParam,
	populateCallableMember,
	populatePropertyMember,
	type ExtractContext
} from './typescript-extract-shared.ts';
import { resolveTypeInfo } from './typescript-extract-type-json.ts';
import { extractTypeAliasProperties } from './typescript-extract-type-properties.ts';

/**
 * Extract type/interface information with rich property metadata.
 *
 * @internal Used by `analyzeDeclaration` — not part of the public barrel export.
 *
 * @param node - the declaration AST node
 * @param declaration - the declaration to populate
 * @param ctx - the extraction pass's context
 * @mutates declaration - adds typeSignature, genericParams, extends, intersects, members (and `partial: true` on extraction failure)
 * @mutates ctx.diagnostics - adds `type_extraction_failed` / `signature_analysis_failed` diagnostics on checker errors
 */
export const extractTypeInfo = (
	node: ts.Node,
	declaration: DeclarationJsonBuild,
	ctx: ExtractContext
): void => {
	const { checker, diagnostics } = ctx;
	let nodeType: ts.Type | undefined;
	try {
		nodeType = checker.getTypeAtLocation(node);
		declaration.typeSignature = checker.typeToString(nodeType);
		// structured type on type aliases only — an interface is an object shape,
		// terminal by the `TypeJson` absence contract, and its variant has no field.
		// The right-hand side is the written node: an alias *over* an alias-lost
		// name recovers it (`type B = Inferred` references `Inferred`).
		// `ownAliasName` doubles as the registry self-skip — see `resolveTypeInfo`
		if (ts.isTypeAliasDeclaration(node)) {
			const typeInfo = resolveTypeInfo(nodeType, checker, ctx.aliasRegistry, false, {
				ownAliasName: node.name.text,
				writtenNode: node.type
			});
			if (typeInfo) declaration.typeInfo = typeInfo;
		}
	} catch (err) {
		declaration.partial = true;
		const loc = getNodeLocation(node);
		diagnostics.push({
			kind: 'type_extraction_failed',
			file: loc.file,
			line: loc.line,
			column: loc.column,
			message: `Failed to extract type for "${declaration.name}": ${to_error_message(err)}`,
			severity: 'warning',
			symbolName: declaration.name ?? '<default export>'
		});
	}

	if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) {
		if (node.typeParameters?.length) {
			declaration.genericParams = node.typeParameters.map(parseGenericParam);
		}
	}

	if (ts.isTypeAliasDeclaration(node) && nodeType) {
		extractTypeAliasProperties(node, nodeType, declaration, ctx);
	}

	if (ts.isInterfaceDeclaration(node)) {
		if (node.heritageClauses) {
			declaration.extends = node.heritageClauses
				.filter((hc) => hc.token === ts.SyntaxKind.ExtendsKeyword)
				.flatMap((hc) => hc.types.map((t) => t.getText()));
		}

		// Extract properties and method signatures with full metadata
		const processedMethods: Set<string> = new Set();

		for (const member of node.members) {
			if (ts.isPropertySignature(member)) {
				// `memberNameText` covers identifier and string/numeric-literal names
				// (`'data-foo': string`, `42: boolean`) like the symbol-based type-alias
				// path; computed names stay skipped (runtime-dependent)
				const propName = memberNameText(member.name);
				if (propName === undefined) continue;
				const propDeclaration: MemberJsonBuild = {
					name: propName,
					kind: 'variable'
				};

				const optional = !!member.questionToken;
				if (optional) {
					propDeclaration.optional = true;
				}

				// Extract modifiers
				const modifierFlags = extractModifiers(ts.getModifiers(member));
				if (modifierFlags.length > 0) {
					propDeclaration.modifiers = modifierFlags;
				}

				const propTsdoc = parseComment(member, node.getSourceFile());

				// Resolve the type through the checker like the type-alias property
				// path — discovery stays on `node.members` (own members only), typing
				// doesn't; the written annotation feeds `typeInfo` name recovery.
				// `populatePropertyMember` owns the TSDoc application (the `@default`
				// gate reads the settled kind), so the paths where it never ran
				// apply the docs themselves.
				try {
					const propSymbol = checker.getSymbolAtLocation(member.name);
					if (propSymbol) {
						const propType = checker.getTypeOfSymbolAtLocation(propSymbol, member);
						populatePropertyMember(
							propDeclaration,
							propType,
							ctx,
							optional,
							propTsdoc,
							member,
							propName,
							member.type
						);
					} else {
						applyToDeclaration(propDeclaration, propTsdoc, true);
					}
				} catch (err) {
					propDeclaration.partial = true;
					applyToDeclaration(propDeclaration, propTsdoc, true);
					const loc = getNodeLocation(member);
					diagnostics.push({
						kind: 'type_extraction_failed',
						file: loc.file,
						line: loc.line,
						column: loc.column,
						message: `Failed to extract type for interface property "${propName}" in "${declaration.name}": ${to_error_message(err)}`,
						severity: 'warning',
						symbolName: propName
					});
				}

				(declaration.members ??= []).push(propDeclaration);
			} else if (ts.isMethodSignature(member) && member.name) {
				// literal names unquoted like the property path; computed names keep
				// their written text (`[Symbol.iterator]`)
				const methodName = memberNameText(member.name) ?? member.name.getText();
				if (!methodName || processedMethods.has(methodName)) continue;
				processedMethods.add(methodName);

				const methodDeclaration: MemberJsonBuild = {
					name: methodName,
					kind: 'function'
				};

				if (member.questionToken) {
					methodDeclaration.optional = true;
				}

				// Extract modifiers
				const modifierFlags = extractModifiers(ts.getModifiers(member));
				if (modifierFlags.length > 0) {
					methodDeclaration.modifiers = modifierFlags;
				}

				// Extract generic type parameters
				if (member.typeParameters?.length) {
					methodDeclaration.genericParams = member.typeParameters.map(parseGenericParam);
				}

				// Extract TSDoc
				const methodTsdoc = parseComment(member, node.getSourceFile());
				applyToDeclaration(methodDeclaration, methodTsdoc, true);

				// Extract signatures via type checker
				try {
					const memberSymbol = checker.getSymbolAtLocation(member.name);
					if (memberSymbol) {
						const memberType = checker.getTypeOfSymbolAtLocation(memberSymbol, member);
						// an optional method resolves to a union with `undefined`, which
						// reports no call signatures — strip it before asking
						const callableType = member.questionToken
							? getNonOptionalType(memberType, checker)
							: memberType;
						populateCallableMember(
							methodDeclaration,
							callableType.getCallSignatures(),
							ctx,
							methodTsdoc,
							member,
							methodName
						);
					}
				} catch (err) {
					methodDeclaration.partial = true;
					const loc = getNodeLocation(member);
					diagnostics.push({
						kind: 'signature_analysis_failed',
						file: loc.file,
						line: loc.line,
						column: loc.column,
						message: `Failed to analyze interface method "${methodName}": ${to_error_message(err)}`,
						severity: 'warning',
						functionName: methodName
					});
				}

				(declaration.members ??= []).push(methodDeclaration);
			} else if (ts.isIndexSignatureDeclaration(member)) {
				const param = member.parameters[0];
				if (param && ts.isIdentifier(param.name) && param.type) {
					const keyType = param.type.getText();
					const name = `[${param.name.text}: ${keyType}]`;
					const indexDeclaration: MemberJsonBuild = { name, kind: 'variable' };

					// `readonly [key: string]: T` carries the modifier like a property
					const indexModifiers = extractModifiers(ts.getModifiers(member));
					if (indexModifiers.length > 0) {
						indexDeclaration.modifiers = indexModifiers;
					}

					if (member.type) {
						// checker-render the value type from the own-member node (the
						// merged type's index info could carry inherited signatures)
						try {
							const indexType = checker.getTypeFromTypeNode(member.type);
							// no optional strip on either output — `optional` is N/A for index signatures
							indexDeclaration.typeSignature = checker.typeToString(indexType);
							const typeInfo = resolveTypeInfo(indexType, checker, ctx.aliasRegistry, false, {
								writtenNode: member.type
							});
							if (typeInfo) indexDeclaration.typeInfo = typeInfo;
						} catch (err) {
							indexDeclaration.partial = true;
							const loc = getNodeLocation(member);
							diagnostics.push({
								kind: 'type_extraction_failed',
								file: loc.file,
								line: loc.line,
								column: loc.column,
								message: `Failed to extract type for index signature "${name}" in "${declaration.name}": ${to_error_message(err)}`,
								severity: 'warning',
								symbolName: name
							});
						}
					}
					const indexTsdoc = parseComment(member, node.getSourceFile());
					applyToDeclaration(indexDeclaration, indexTsdoc, true);
					(declaration.members ??= []).push(indexDeclaration);
				}
			}
		}

		// Extract call and construct signatures from interface type. TSDoc comes
		// from inline signature declarations on this interface — inherited
		// signatures resolve through `getCallSignatures()` but their docs are
		// intentionally not surfaced here.
		const interfaceType = nodeType ?? checker.getTypeAtLocation(node);
		const errorContext = { node, kindLabel: 'interface' };

		emitCallOrConstructSignature(
			() => interfaceType.getCallSignatures(),
			'call',
			() => node.members.find(ts.isCallSignatureDeclaration),
			node,
			declaration,
			ctx,
			errorContext
		);

		emitCallOrConstructSignature(
			() => interfaceType.getConstructSignatures(),
			'construct',
			() => node.members.find(ts.isConstructSignatureDeclaration),
			node,
			declaration,
			ctx,
			errorContext
		);
	}
};

/**
 * Extract enum member information from an enum declaration.
 *
 * Iterates `node.members` to extract each enum member's name, initializer value,
 * type, and JSDoc. Members are represented as `MemberJson` with kind `'variable'`.
 *
 * @internal Used by `analyzeDeclaration` — not part of the public barrel export.
 *
 * @mutates declaration - adds members and typeSignature
 */
export const extractEnumInfo = (
	node: ts.Node,
	declaration: DeclarationJsonBuild,
	ctx: ExtractContext
): void => {
	const { checker, diagnostics } = ctx;
	// Extract type signature
	try {
		const nodeType = checker.getTypeAtLocation(node);
		declaration.typeSignature = checker.typeToString(nodeType);
	} catch (err) {
		declaration.partial = true;
		const loc = getNodeLocation(node);
		diagnostics.push({
			kind: 'type_extraction_failed',
			file: loc.file,
			line: loc.line,
			column: loc.column,
			message: `Failed to extract type for "${declaration.name}": ${to_error_message(err)}`,
			severity: 'warning',
			symbolName: declaration.name ?? '<default export>'
		});
	}

	if (!ts.isEnumDeclaration(node)) return;

	for (const member of node.members) {
		const memberName = ts.isIdentifier(member.name)
			? member.name.text
			: ts.isStringLiteral(member.name)
				? member.name.text
				: member.name.getText();
		if (!memberName) continue;

		const memberDeclaration: MemberJsonBuild = {
			name: memberName,
			kind: 'variable'
		};

		// Extract TSDoc
		const memberTsdoc = parseComment(member, node.getSourceFile());
		applyToDeclaration(memberDeclaration, memberTsdoc, true);

		// Extract type and value via the checker
		try {
			const memberSymbol = checker.getSymbolAtLocation(member.name);
			if (memberSymbol) {
				const memberType = checker.getTypeOfSymbolAtLocation(memberSymbol, member);
				memberDeclaration.typeSignature = checker.typeToString(memberType);
			}
		} catch (err) {
			memberDeclaration.partial = true;
			const loc = getNodeLocation(member);
			diagnostics.push({
				kind: 'type_extraction_failed',
				file: loc.file,
				line: loc.line,
				column: loc.column,
				message: `Failed to extract type for enum member "${memberName}" in "${declaration.name}": ${to_error_message(err)}`,
				severity: 'warning',
				symbolName: memberName
			});
		}

		(declaration.members ??= []).push(memberDeclaration);
	}
};
