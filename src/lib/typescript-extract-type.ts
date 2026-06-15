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

import type {DeclarationJsonBuild, MemberJsonBuild} from './declaration-build.js';
import {type Diagnostic} from './diagnostics.js';
import {to_error_message} from './error.js';
import {parseComment, applyToDeclaration} from './tsdoc.js';
import {type IsExternalFile} from './typescript-program.js';
import {
	emitCallOrConstructSignature,
	extractModifiers,
	getNodeLocation,
	parseGenericParam,
	populateCallableMember,
} from './typescript-extract-shared.js';
import {extractTypeAliasProperties} from './typescript-extract-type-properties.js';

/**
 * Extract type/interface information with rich property metadata.
 *
 * @internal Used by `analyzeDeclaration` — not part of the public barrel export.
 *
 * @param node - the declaration AST node
 * @param checker - TypeScript type checker
 * @param declaration - the declaration to populate
 * @param diagnostics - diagnostics collector for non-fatal issues
 * @mutates declaration - adds typeSignature, genericParams, extends, intersects, members (and `partial: true` on extraction failure)
 * @mutates diagnostics - adds `type_extraction_failed` / `signature_analysis_failed` diagnostics on checker errors
 */
export const extractTypeInfo = (
	node: ts.Node,
	checker: ts.TypeChecker,
	declaration: DeclarationJsonBuild,
	diagnostics: Array<Diagnostic>,
	isExternalFile: IsExternalFile,
): void => {
	let nodeType: ts.Type | undefined;
	try {
		nodeType = checker.getTypeAtLocation(node);
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
			symbolName: declaration.name ?? '<default export>',
		});
	}

	if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) {
		if (node.typeParameters?.length) {
			declaration.genericParams = node.typeParameters.map(parseGenericParam);
		}
	}

	if (ts.isTypeAliasDeclaration(node) && nodeType) {
		extractTypeAliasProperties(node, nodeType, checker, declaration, diagnostics, isExternalFile);
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
			if (ts.isPropertySignature(member) && ts.isIdentifier(member.name)) {
				const propName = member.name.text;
				const propDeclaration: MemberJsonBuild = {
					name: propName,
					kind: 'variable',
				};

				if (member.questionToken) {
					propDeclaration.optional = true;
				}

				// Extract modifiers
				const modifierFlags = extractModifiers(ts.getModifiers(member));
				if (modifierFlags.length > 0) {
					propDeclaration.modifiers = modifierFlags;
				}

				// Extract type
				if (member.type) {
					propDeclaration.typeSignature = member.type.getText();
				}

				// Extract TSDoc (applies docComment, examples, deprecated, seeAlso, since)
				const propTsdoc = parseComment(member, node.getSourceFile());
				applyToDeclaration(propDeclaration, propTsdoc);

				(declaration.members ??= []).push(propDeclaration);
			} else if (ts.isMethodSignature(member) && member.name) {
				const methodName = ts.isIdentifier(member.name) ? member.name.text : member.name.getText();
				if (!methodName || processedMethods.has(methodName)) continue;
				processedMethods.add(methodName);

				const methodDeclaration: MemberJsonBuild = {
					name: methodName,
					kind: 'function',
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
				applyToDeclaration(methodDeclaration, methodTsdoc);

				// Extract signatures via type checker
				try {
					const memberSymbol = checker.getSymbolAtLocation(member.name);
					if (memberSymbol) {
						const memberType = checker.getTypeOfSymbolAtLocation(memberSymbol, member);
						populateCallableMember(
							methodDeclaration,
							memberType.getCallSignatures(),
							checker,
							methodTsdoc,
							member,
							methodName,
							diagnostics,
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
						functionName: methodName,
					});
				}

				(declaration.members ??= []).push(methodDeclaration);
			} else if (ts.isIndexSignatureDeclaration(member)) {
				const param = member.parameters[0];
				if (param && ts.isIdentifier(param.name) && param.type) {
					const keyType = param.type.getText();
					const name = `[${param.name.text}: ${keyType}]`;
					const indexDeclaration: MemberJsonBuild = {name, kind: 'variable'};

					if (member.type) {
						indexDeclaration.typeSignature = member.type.getText();
					}
					const indexTsdoc = parseComment(member, node.getSourceFile());
					applyToDeclaration(indexDeclaration, indexTsdoc);
					(declaration.members ??= []).push(indexDeclaration);
				}
			}
		}

		// Extract call and construct signatures from interface type. TSDoc comes
		// from inline signature declarations on this interface — inherited
		// signatures resolve through `getCallSignatures()` but their docs are
		// intentionally not surfaced here.
		const interfaceType = nodeType ?? checker.getTypeAtLocation(node);
		const errorContext = {node, kindLabel: 'interface'};

		emitCallOrConstructSignature(
			() => interfaceType.getCallSignatures(),
			'call',
			() => node.members.find(ts.isCallSignatureDeclaration),
			node,
			declaration,
			checker,
			diagnostics,
			errorContext,
		);

		emitCallOrConstructSignature(
			() => interfaceType.getConstructSignatures(),
			'construct',
			() => node.members.find(ts.isConstructSignatureDeclaration),
			node,
			declaration,
			checker,
			diagnostics,
			errorContext,
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
	checker: ts.TypeChecker,
	declaration: DeclarationJsonBuild,
	diagnostics: Array<Diagnostic>,
): void => {
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
			symbolName: declaration.name ?? '<default export>',
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
			kind: 'variable',
		};

		// Extract TSDoc
		const memberTsdoc = parseComment(member, node.getSourceFile());
		applyToDeclaration(memberDeclaration, memberTsdoc);

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
				symbolName: memberName,
			});
		}

		(declaration.members ??= []).push(memberDeclaration);
	}
};
