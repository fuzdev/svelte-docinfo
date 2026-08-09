/**
 * Per-declaration extractors for TypeScript functions and variables.
 *
 * Both `extractFunctionInfo` and `extractVariableInfo` mutate a
 * `DeclarationJsonBuild` with rich metadata derived from the TypeScript
 * checker. Called by `analyzeDeclaration` in `typescript-exports.ts` once
 * kind dispatch is settled.
 *
 * @see `typescript-extract-shared.ts` for shared helpers (signatures,
 *   overloads, generics, reactivity)
 *
 * @module
 */

import ts from 'typescript';

import type { DeclarationJsonBuild } from './declaration-build.ts';
import { to_error_message } from './error.ts';
import type { TsdocParsedComment } from './tsdoc.ts';
import { resolveTypeInfo } from './typescript-extract-type-json.ts';
import {
	detectReactivity,
	getNodeLocation,
	parseGenericParam,
	populateCallableMember,
	type ExtractContext
} from './typescript-extract-shared.ts';

/**
 * Extract function/method information including parameters
 * with descriptions and default values.
 *
 * @internal Used by `analyzeDeclaration` — not part of the public barrel export.
 *
 * @param node - the declaration AST node
 * @param symbol - the TypeScript symbol
 * @param declaration - the declaration to populate
 * @param tsdoc - parsed TSDoc comment (if available)
 * @param ctx - the extraction pass's context
 * @mutates declaration - adds typeSignature, returnType, returnDescription, parameters, genericParams, overloads (and `partial: true` on signature failure)
 * @mutates ctx.diagnostics - adds `signature_analysis_failed` diagnostic on checker error
 */
export const extractFunctionInfo = (
	node: ts.Node,
	symbol: ts.Symbol,
	declaration: DeclarationJsonBuild,
	tsdoc: TsdocParsedComment | undefined,
	ctx: ExtractContext
): void => {
	try {
		const type = ctx.checker.getTypeOfSymbolAtLocation(symbol, node);
		const signatures = type.getCallSignatures();
		populateCallableMember(declaration, signatures, ctx, tsdoc, node, symbol.name);
	} catch (err) {
		declaration.partial = true;
		const loc = getNodeLocation(node);
		ctx.diagnostics.push({
			kind: 'signature_analysis_failed',
			file: loc.file,
			line: loc.line,
			column: loc.column,
			message: `Failed to analyze signature for "${symbol.name}": ${to_error_message(err)}`,
			severity: 'warning',
			functionName: symbol.name
		});
	}

	// Extract generic type parameters
	let typeParameters: ts.NodeArray<ts.TypeParameterDeclaration> | undefined;
	if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
		typeParameters = node.typeParameters;
	} else if (ts.isVariableDeclaration(node)) {
		if (node.type && ts.isFunctionTypeNode(node.type)) {
			// `export const fn: <T>(x: T) => T = (x) => x` — generics on the type annotation.
			// Annotation wins over initializer when both carry generics: it's the public type.
			typeParameters = node.type.typeParameters;
		} else if (
			node.initializer &&
			(ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
		) {
			// `export const foo = <T>(x: T) => x` — generics live on the initializer, not the variable.
			typeParameters = node.initializer.typeParameters;
		}
	}
	if (typeParameters?.length) {
		declaration.genericParams = typeParameters.map(parseGenericParam);
	}
};

/**
 * Extract variable information.
 *
 * @internal Used by `analyzeDeclaration` — not part of the public barrel export.
 *
 * @param node - the declaration AST node
 * @param symbol - the TypeScript symbol
 * @param declaration - the declaration to populate
 * @param ctx - the extraction pass's context
 * @mutates declaration - adds typeSignature, reactivity (when initialized with a Svelte rune)
 */
export const extractVariableInfo = (
	node: ts.Node,
	symbol: ts.Symbol,
	declaration: DeclarationJsonBuild,
	ctx: ExtractContext
): void => {
	const { checker } = ctx;
	try {
		const type = checker.getTypeOfSymbolAtLocation(symbol, node);
		declaration.typeSignature = checker.typeToString(type);
		const annotation = ts.isVariableDeclaration(node) ? node.type : undefined;
		const typeInfo = resolveTypeInfo(type, checker, ctx.aliasRegistry, false, {
			writtenNode: annotation
		});
		if (typeInfo) declaration.typeInfo = typeInfo;
	} catch (err) {
		declaration.partial = true;
		const loc = getNodeLocation(node);
		ctx.diagnostics.push({
			kind: 'type_extraction_failed',
			file: loc.file,
			line: loc.line,
			column: loc.column,
			message: `Failed to extract type for variable "${symbol.name}": ${to_error_message(err)}`,
			severity: 'warning',
			symbolName: symbol.name
		});
	}

	// Outside the try so reactivity is still captured if type extraction throws.
	if (ts.isVariableDeclaration(node)) {
		const reactivity = detectReactivity(node.initializer);
		if (reactivity) declaration.reactivity = reactivity;
	}
};
