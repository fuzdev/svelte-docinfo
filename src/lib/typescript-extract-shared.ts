/**
 * Shared utilities for the per-declaration extractors in `typescript-extract-*.ts`.
 *
 * Holds helpers used across function, type, and class extraction: signature
 * parameter extraction, overload detection, generic parsing, modifier
 * extraction, location reporting, intersection-property filtering, and runes
 * detection.
 *
 * @see `typescript-extract-function.ts`, `typescript-extract-type.ts`,
 *   `typescript-extract-class.ts` for the per-declaration extractors that
 *   build on these helpers
 *
 * @module
 */

import ts from 'typescript';

import type {
	GenericParamJson,
	DeclarationKind,
	DeclarationModifier,
	MemberKind,
	ParameterJson,
	OverloadJsonInput,
	Reactivity,
} from './types.ts';
import type {DeclarationJsonBuild, MemberJsonBuild} from './declaration-build.ts';
import {type Diagnostic, type MisplacedTagDiagnostic} from './diagnostics.ts';
import {to_error_message} from './error.ts';
import {applyToDeclaration, parseComment, type TsdocParsedComment} from './tsdoc.ts';
import {type IsExternalFile} from './typescript-program.ts';

/**
 * Infer declaration kind from symbol and node.
 *
 * Maps TypeScript constructs to `DeclarationKind`:
 * - Classes → `'class'`
 * - Functions (declarations, expressions, arrows) → `'function'`
 * - Interfaces → `'interface'`
 * - Type aliases → `'type'`
 * - Enums (regular and const) → `'enum'`
 * - Variables → `'variable'` (unless function-valued → `'function'`)
 *
 * Note: namespace re-exports (`export * as ns from './x'`) have no inline
 * declaration form in TypeScript and are caught upstream in `analyzeExports`
 * via `classifyNamespaceReExport`. They never reach this function. A direct
 * call here on a `ValueModule` symbol would fall through to `'variable'` and
 * leak `typeof import("/abs/path")` into the output — keep the namespace
 * dispatch in `analyzeExports`.
 */
export const inferDeclarationKind = (symbol: ts.Symbol, node: ts.Node): DeclarationKind => {
	// Check symbol flags
	if (symbol.flags & ts.SymbolFlags.Class) return 'class';
	if (symbol.flags & ts.SymbolFlags.Function) return 'function';
	if (symbol.flags & ts.SymbolFlags.Interface) return 'interface';
	if (symbol.flags & ts.SymbolFlags.TypeAlias) return 'type';
	if (symbol.flags & ts.SymbolFlags.Enum) return 'enum';
	if (symbol.flags & ts.SymbolFlags.ConstEnum) return 'enum';

	// Check node kind
	if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node))
		return 'function';
	if (ts.isClassDeclaration(node)) return 'class';
	if (ts.isInterfaceDeclaration(node)) return 'interface';
	if (ts.isTypeAliasDeclaration(node)) return 'type';
	if (ts.isEnumDeclaration(node)) return 'enum';
	if (ts.isVariableDeclaration(node)) {
		// Check if it's a function-valued variable
		const init = node.initializer;
		if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
			return 'function';
		}
		return 'variable';
	}

	return 'variable';
};

/**
 * Extract parameters from a TypeScript signature with TSDoc descriptions and default values.
 *
 * Shared helper for extracting parameter information from both standalone functions
 * and class methods/constructors.
 *
 * @param sig - the TypeScript signature to extract parameters from
 * @param checker - TypeScript type checker for type resolution
 * @param tsdocParams - record of parameter names to TSDoc descriptions (from `TsdocParsedComment.params`)
 * @returns array of `ParameterJson` objects
 */
export const extractSignatureParameters = (
	sig: ts.Signature,
	checker: ts.TypeChecker,
	tsdocParams: Record<string, string> | undefined,
): Array<ParameterJson> => {
	return sig.parameters.map((param) => {
		const paramDecl = param.valueDeclaration;

		// Get type - use declaration location if available, otherwise get declared type
		let typeString = 'unknown';
		if (paramDecl) {
			const paramType = checker.getTypeOfSymbolAtLocation(param, paramDecl);
			typeString = checker.typeToString(paramType);
		} else {
			const paramType = checker.getDeclaredTypeOfSymbol(param);
			typeString = checker.typeToString(paramType);
		}

		// Get TSDoc description for this parameter
		const description = tsdocParams?.[param.name];

		// Collect dotted `@param obj.prop` descriptions for object/destructured
		// parameters, keyed by the sub-path relative to this parameter
		// (`obj.prop` → `prop`, `obj.a.b` → `a.b`).
		let propertyDescriptions: Record<string, string> | undefined;
		if (tsdocParams) {
			const prefix = param.name + '.';
			for (const [key, value] of Object.entries(tsdocParams)) {
				if (key.startsWith(prefix)) {
					// Null-prototype map: the sliced sub-path is source-derived and is
					// emitted as `propertyDescriptions`; a `@param obj.__proto__` key on a
					// plain object would pollute the prototype on write.
					(propertyDescriptions ??= Object.create(null))[key.slice(prefix.length)] = value;
				}
			}
		}

		// Extract default value from AST
		let defaultValue: string | undefined;
		if (paramDecl && ts.isParameter(paramDecl) && paramDecl.initializer) {
			defaultValue = paramDecl.initializer.getText();
		}

		const optional = !!(paramDecl && ts.isParameter(paramDecl) && paramDecl.questionToken);
		const rest = !!(paramDecl && ts.isParameter(paramDecl) && paramDecl.dotDotDotToken);

		return {
			name: param.name,
			type: typeString,
			optional,
			rest,
			description,
			defaultValue,
			propertyDescriptions,
		};
	});
};

/**
 * Emit `unknown_param` warnings for `@param` keys that don't reference a real
 * parameter. Catches typos (`@param argz` for `args`) and stale doc after a
 * rename. The description is dropped silently by `extractSignatureParameters`;
 * this surfaces the drop without halting. Dotted keys (`@param obj.prop`) that
 * document a property of an object parameter are accepted when `obj` is a real
 * parameter.
 *
 * @internal Helper for `extractOverloads` and other `@param`-extracting sites.
 */
const validateParamKeys = (
	tsdocParams: Record<string, string> | undefined,
	parameters: ReadonlyArray<{name: string}>,
	declNode: ts.Node,
	functionName: string,
	diagnostics: Array<Diagnostic>,
): void => {
	if (!tsdocParams) return;
	const known = new Set(parameters.map((p) => p.name));
	for (const key of Object.keys(tsdocParams)) {
		// Dotted keys (`@param obj.prop`) document a property of an object/destructured
		// parameter — valid JSDoc/TSDoc. Treat as known when the root segment is a real param.
		const root = key.includes('.') ? key.slice(0, key.indexOf('.')) : key;
		if (!known.has(key) && !known.has(root)) {
			const loc = getNodeLocation(declNode);
			diagnostics.push({
				kind: 'unknown_param',
				file: loc.file,
				line: loc.line,
				column: loc.column,
				message: `@param "${key}" on "${functionName}" doesn't match any parameter (typo or stale doc?)`,
				severity: 'warning',
				paramName: key,
				functionName,
			});
		}
	}
};

/**
 * Collect symbol-scope JSDoc tags present on a parsed comment.
 *
 * Symbol-scope tags describe the function as a whole and belong on the
 * primary signature's JSDoc (which feeds the parent declaration). Used by
 * `extractOverloads` to detect tags misplaced on non-primary overloads.
 *
 * @internal
 */
const collectSymbolScopeTags = (
	tsdoc: TsdocParsedComment,
): Array<MisplacedTagDiagnostic['tagName']> => {
	const found: Array<MisplacedTagDiagnostic['tagName']> = [];
	if (tsdoc.examples?.length) found.push('example');
	if (tsdoc.deprecatedMessage !== undefined) found.push('deprecated');
	if (tsdoc.since) found.push('since');
	if (tsdoc.seeAlso?.length) found.push('see');
	if (tsdoc.throws?.length) found.push('throws');
	if (tsdoc.mutates && Object.keys(tsdoc.mutates).length > 0) found.push('mutates');
	if (tsdoc.defaultValue !== undefined) found.push('default');
	if (tsdoc.nodocs) found.push('nodocs');
	return found;
};

/**
 * Extract all public overload signatures for a function.
 *
 * Each overload gets its own typeSignature, parameters, returnType, and
 * per-overload JSDoc if available. The implementation signature is excluded
 * (TypeScript's `getCallSignatures()` already omits it).
 *
 * Per-overload `@param` descriptions flow through to that overload's
 * `parameters[i].description`. Per-overload `@returns` populates
 * `returnDescription`. These are signature-scope: each overload may
 * describe its own parameters and return value distinctly.
 *
 * Symbol-scope tags (`@example`, `@deprecated`, `@since`, `@see`, `@throws`,
 * `@mutates`) describe the function as a whole and belong on the parent
 * declaration. The primary overload — the one whose JSDoc text matches the
 * parent's `docComment` — already feeds the parent's symbol-level extraction,
 * so its symbol-scope tags reach the parent through that path. On non-primary
 * overloads, symbol-scope tags would otherwise be silently dropped from
 * output; this function emits a `misplaced_tag` warning instead, pointing the
 * author at the primary signature.
 *
 * @param signatures - all call signatures from the type checker
 * @param checker - TypeScript type checker
 * @param parentTsdoc - parsed JSDoc of the parent declaration (for primary-signature detection)
 * @param parentName - parent function/method name (for diagnostic messages)
 * @param diagnostics - diagnostics collector for non-fatal issues
 * @returns array of overload info objects
 */
const extractOverloads = (
	signatures: ReadonlyArray<ts.Signature>,
	checker: ts.TypeChecker,
	parentTsdoc: TsdocParsedComment | undefined,
	parentName: string,
	diagnostics: Array<Diagnostic>,
): Array<OverloadJsonInput> => {
	return signatures.map((sig) => {
		const decl = sig.getDeclaration();
		const sourceFile = decl.getSourceFile();
		const tsdoc = parseComment(decl, sourceFile);

		const typeSignature = checker.signatureToString(sig);
		const returnType = checker.typeToString(checker.getReturnTypeOfSignature(sig));
		const parameters = extractSignatureParameters(sig, checker, tsdoc?.params);

		validateParamKeys(tsdoc?.params, parameters, decl, parentName, diagnostics);

		const overload: OverloadJsonInput = {typeSignature, parameters, returnType};

		if (tsdoc?.text) {
			overload.docComment = tsdoc.text;
		}
		if (tsdoc?.returns) {
			overload.returnDescription = tsdoc.returns;
		}

		// Extract per-overload generic type parameters
		if (ts.isFunctionLike(decl) && decl.typeParameters?.length) {
			overload.genericParams = decl.typeParameters.map(parseGenericParam);
		}

		// Detect primary overload by matching JSDoc text against the parent's.
		// The TS API resolves the parent declaration's JSDoc by walking from the
		// implementation node to the first overload signature with JSDoc; that
		// signature is the "primary" — its symbol-scope tags already reach the
		// parent through symbol-level extraction. Non-primary overloads with
		// symbol-scope tags would silently lose them; surface as warnings instead.
		const isPrimary =
			tsdoc?.text !== undefined &&
			parentTsdoc?.text !== undefined &&
			tsdoc.text === parentTsdoc.text;
		if (!isPrimary && tsdoc) {
			const misplaced = collectSymbolScopeTags(tsdoc);
			if (misplaced.length > 0) {
				const loc = getNodeLocation(decl);
				for (const tagName of misplaced) {
					diagnostics.push({
						kind: 'misplaced_tag',
						file: loc.file,
						line: loc.line,
						column: loc.column,
						message: `@${tagName} on non-primary overload of "${parentName}" — place it on the primary signature's JSDoc instead (symbol-scope tags describe the function as a whole)`,
						severity: 'warning',
						tagName,
						functionName: parentName,
					});
				}
			}
		}

		return overload;
	});
};

/**
 * Populate the callable fields of a declaration or member from its call/construct
 * signatures: `typeSignature`, `parameters`, `overloads`, and (unless
 * `includeReturn` is false) `returnType` / `returnDescription`.
 *
 * The shared core of every named-callable extractor — standalone functions,
 * interface methods, class methods/constructors, and type-alias function
 * properties. Callers differ in how they obtain `signatures` (symbol type,
 * constructor declarations, property call signatures) and in their own
 * try/catch + diagnostic kind, so those stay at the callsite; this captures
 * only the identical projection from a resolved signature list onto the build
 * target. No-op when `signatures` is empty.
 *
 * @param target - declaration or member build object (mutated)
 * @param signatures - public call/construct signatures (`signatures[0]` is primary)
 * @param tsdoc - parsed TSDoc for the target (supplies `@param`/`@returns`)
 * @param paramValidationNode - node `validateParamKeys` reports `unknown_param` against
 * @param name - target name, for diagnostic messages
 * @param includeReturn - set `false` for constructors (no return type/description)
 * @mutates target - sets typeSignature, parameters, overloads, returnType, returnDescription
 * @mutates diagnostics - via `validateParamKeys` / `extractOverloads`
 */
export const populateCallableMember = (
	target: DeclarationJsonBuild | MemberJsonBuild,
	signatures: ReadonlyArray<ts.Signature>,
	checker: ts.TypeChecker,
	tsdoc: TsdocParsedComment | undefined,
	paramValidationNode: ts.Node,
	name: string,
	diagnostics: Array<Diagnostic>,
	includeReturn = true,
): void => {
	if (signatures.length === 0) return;
	const sig = signatures[0]!;

	target.typeSignature = checker.signatureToString(sig);

	if (includeReturn) {
		target.returnType = checker.typeToString(checker.getReturnTypeOfSignature(sig));
		if (tsdoc?.returns) target.returnDescription = tsdoc.returns;
	}

	target.parameters = extractSignatureParameters(sig, checker, tsdoc?.params);
	validateParamKeys(tsdoc?.params, target.parameters, paramValidationNode, name, diagnostics);

	if (signatures.length > 1) {
		target.overloads = extractOverloads(signatures, checker, tsdoc, name, diagnostics);
	}
};

/**
 * Check whether all declarations of a property symbol are in external source files.
 * Properties with no declarations (synthesized) are considered non-external.
 */
const isExternalProperty = (prop: ts.Symbol, isExternalFile: IsExternalFile): boolean => {
	const decls = prop.getDeclarations();
	if (!decls?.length) return false;
	return decls.every((d) => isExternalFile(d.getSourceFile()));
};

/**
 * Determine whether an intersection branch refers to a type whose declarations
 * all live in external files (e.g., `HTMLAttributes<HTMLDivElement>` from svelte's
 * d.ts). Inline object-literal branches and unrecognized node shapes return false
 * (treated as local).
 */
export const isExternalIntersectionBranch = (
	branchNode: ts.TypeNode,
	checker: ts.TypeChecker,
	isExternalFile: IsExternalFile,
): boolean => {
	if (!ts.isTypeReferenceNode(branchNode) && !ts.isIndexedAccessTypeNode(branchNode)) {
		return false;
	}
	const branchType = checker.getTypeAtLocation(branchNode);
	const sym = branchType.aliasSymbol ?? branchType.symbol;
	const decls = sym.getDeclarations();
	if (!decls?.length) return false;
	return decls.every((d) => isExternalFile(d.getSourceFile()));
};

/**
 * Resolve the `IntersectionTypeNode` for a type node, walking through type
 * alias indirection. Returns `undefined` when the underlying type is an
 * intersection but no AST node is recoverable (rare — synthesized intersections).
 */
export const resolveIntersectionTypeNode = (
	type: ts.Type,
	typeNode: ts.Node,
): ts.IntersectionTypeNode | undefined => {
	if (ts.isIntersectionTypeNode(typeNode)) return typeNode;
	const aliasDecl = type.aliasSymbol?.declarations?.[0];
	if (
		aliasDecl &&
		ts.isTypeAliasDeclaration(aliasDecl) &&
		ts.isIntersectionTypeNode(aliasDecl.type)
	) {
		return aliasDecl.type;
	}
	return undefined;
};

/**
 * Determine whether a type-reference / indexed-access node names a type whose
 * properties all come from external files (e.g. `SvelteHTMLElements['li']`,
 * `HTMLAttributes<HTMLDivElement>`). Such a node is an external attribute "bag"
 * that should be summarized in `intersects` rather than enumerated as members.
 *
 * Mirrors the per-property origin test used for membership: external only when
 * the node has at least one property and every property is external. A
 * zero-property branch (e.g. a pure index signature) is not surfaced — there is
 * no named member to attribute to it.
 */
const isExternalTypeRefNode = (
	node: ts.TypeNode,
	checker: ts.TypeChecker,
	isExternalFile: IsExternalFile,
): boolean => {
	const props = checker.getTypeAtLocation(node).getProperties();
	return props.length > 0 && props.every((p) => isExternalProperty(p, isExternalFile));
};

/**
 * Walk a written type node and collect, in source order, the verbatim text of
 * every external type reference it composes.
 *
 * Structure is read from the AST rather than the inferred type because
 * inference erases it: `(A | B) & C` normalizes to a union and `X['k']`
 * flattens to a property bag, both losing the `&`/`|`/index-access shape the
 * author wrote. Composition nodes (intersection, union, parenthesized) recurse;
 * leaf references (`TypeReference`, `IndexedAccessType`) are tested with
 * `isExternalTypeRefNode` and, when external, emitted via `getText()`. Inline
 * object literals and other local shapes contribute no entry.
 *
 * @mutates out - appends each external reference's source text
 */
const collectExternalTypeRefs = (
	node: ts.TypeNode,
	checker: ts.TypeChecker,
	isExternalFile: IsExternalFile,
	out: Array<string>,
): void => {
	if (ts.isParenthesizedTypeNode(node)) {
		collectExternalTypeRefs(node.type, checker, isExternalFile, out);
	} else if (ts.isIntersectionTypeNode(node) || ts.isUnionTypeNode(node)) {
		for (const branch of node.types) collectExternalTypeRefs(branch, checker, isExternalFile, out);
	} else if (ts.isTypeReferenceNode(node) || ts.isIndexedAccessTypeNode(node)) {
		if (isExternalTypeRefNode(node, checker, isExternalFile)) out.push(node.getText());
	}
};

/**
 * Resolve a props/type-alias annotation node to the written type node whose
 * structure drives `intersects` extraction.
 *
 * The svelte2tsx props annotation is a reference to a generated `$$ComponentProps`
 * alias; unwrap one level of *local* type-alias reference so the underlying
 * composition (`SvelteHTMLElements['li']`, `(A | B) & C`, …) is visible. External
 * alias references are left intact so they read as a single named bag rather than
 * leaking their node_modules-internal definition. Type-alias callers pass the
 * written node directly, so for them this is a no-op.
 */
const resolveAnnotationTypeNode = (
	typeNode: ts.Node,
	checker: ts.TypeChecker,
	isExternalFile: IsExternalFile,
): ts.TypeNode | undefined => {
	if (ts.isTypeReferenceNode(typeNode)) {
		const aliasDecl = checker
			.getSymbolAtLocation(typeNode.typeName)
			?.getDeclarations()
			?.find(ts.isTypeAliasDeclaration);
		if (aliasDecl && !isExternalFile(aliasDecl.getSourceFile())) return aliasDecl.type;
	}
	return ts.isTypeNode(typeNode) ? typeNode : undefined;
};

/**
 * Partition a type's properties into local (kept) and external (dropped), and
 * collect the external type references that contributed the dropped ones.
 *
 * Applies to any composition shape — intersection, union, bare reference,
 * indexed-access — not only intersections. Membership is decided per property
 * by declaration origin (`isExternalProperty`), which is structure-agnostic:
 * TypeScript preserves original declaration sources on derived properties, so
 * the test gives the right answer through utility-type wrappers (Partial, Pick,
 * `OmitStrict`) too. A property with no declarations (synthesized) is treated as
 * local and kept. The external-type labels for `intersects` come from an AST
 * walk (`collectExternalTypeRefs`) — the authoritative source for the
 * `&`/`|`/index-access shape inference would otherwise erase.
 */
export const filterExternalProperties = (
	type: ts.Type,
	typeNode: ts.Node,
	checker: ts.TypeChecker,
	isExternalFile: IsExternalFile,
): {properties: Array<ts.Symbol>; externalTypes: Array<string>} => {
	const properties = type
		.getProperties()
		.filter((prop) => !isExternalProperty(prop, isExternalFile));

	const externalTypes: Array<string> = [];
	const annotation = resolveAnnotationTypeNode(typeNode, checker, isExternalFile);
	if (annotation) collectExternalTypeRefs(annotation, checker, isExternalFile, externalTypes);

	return {properties, externalTypes};
};

/**
 * Detect a Svelte 5 reactivity rune from a variable or property initializer.
 *
 * Inspects the AST since runes erase to their inner type after type-checking.
 * Returns `undefined` for any non-rune expression. See the `Reactivity` enum
 * in `types.ts` for the rationale on running this on every file regardless of
 * extension.
 */
export const detectReactivity = (
	initializer: ts.Expression | undefined,
): Reactivity | undefined => {
	// Unwrap type-only wrappers so e.g. `$state(0) as Foo` and `($state(0))` are
	// still detected. Runtime semantics are unchanged by these wrappers.
	let expr: ts.Expression | undefined = initializer;
	while (
		expr &&
		(ts.isParenthesizedExpression(expr) ||
			ts.isAsExpression(expr) ||
			ts.isSatisfiesExpression(expr) ||
			ts.isNonNullExpression(expr) ||
			ts.isTypeAssertionExpression(expr))
	) {
		expr = expr.expression;
	}
	if (!expr || !ts.isCallExpression(expr)) return undefined;
	const callee = expr.expression;

	if (ts.isIdentifier(callee)) {
		if (callee.text === '$state') return '$state';
		if (callee.text === '$derived') return '$derived';
		return undefined;
	}

	if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
		const base = callee.expression.text;
		const prop = callee.name.text;
		if (base === '$state' && prop === 'raw') return '$state.raw';
		if (base === '$derived' && prop === 'by') return '$derived.by';
	}

	return undefined;
};

/**
 * Extract line and column from a TypeScript node.
 * Returns 1-based line and column numbers.
 */
export const getNodeLocation = (node: ts.Node): {file: string; line: number; column: number} => {
	const sourceFile = node.getSourceFile();
	const {line, character} = sourceFile.getLineAndCharacterOfPosition(node.getStart());
	return {
		file: sourceFile.fileName,
		line: line + 1, // Convert to 1-based
		column: character + 1, // Convert to 1-based
	};
};

/**
 * Parse a TypeScript generic type parameter declaration into structured info.
 *
 * @param param - the TypeScript type parameter declaration node
 * @returns structured `GenericParamJson` with name, constraint, and default type
 */
export const parseGenericParam = (param: ts.TypeParameterDeclaration): GenericParamJson => {
	const result: GenericParamJson = {
		name: param.name.text,
	};

	if (param.constraint) {
		result.constraint = param.constraint.getText();
	}

	if (param.default) {
		result.defaultType = param.default.getText();
	}

	return result;
};

/**
 * Extract modifier keywords from a node's modifiers.
 *
 * Returns an array of modifier strings like `['public', 'readonly', 'static']`.
 */
export const extractModifiers = (
	modifiers: ReadonlyArray<ts.ModifierLike> | undefined,
): Array<DeclarationModifier> => {
	const modifierFlags: Array<DeclarationModifier> = [];
	if (!modifiers) return modifierFlags;

	for (const mod of modifiers) {
		if (mod.kind === ts.SyntaxKind.PublicKeyword) modifierFlags.push('public');
		else if (mod.kind === ts.SyntaxKind.ProtectedKeyword) modifierFlags.push('protected');
		else if (mod.kind === ts.SyntaxKind.ReadonlyKeyword) modifierFlags.push('readonly');
		else if (mod.kind === ts.SyntaxKind.StaticKeyword) modifierFlags.push('static');
		else if (mod.kind === ts.SyntaxKind.AbstractKeyword) modifierFlags.push('abstract');
	}

	return modifierFlags;
};

/**
 * Append a `(call)` or `(construct)` signature member to a declaration.
 *
 * Captures the extraction logic shared by interface processing
 * (`extractTypeInfo`) and type-alias property processing
 * (`extractTypeAliasProperties`): type signature, parameters, generics,
 * overloads, and TSDoc. The TSDoc source node is supplied by the caller —
 * interfaces look it up in `node.members` (skipping TSDoc when no inline
 * signature is declared, even if one is inherited), type aliases use
 * `sig.getDeclaration()`.
 *
 * @param getSignatures - thunk to retrieve `getCallSignatures()` /
 *   `getConstructSignatures()`; called inside the try so checker errors are
 *   captured as diagnostics
 * @param signatureKind - `'call'` (member kind: function, includes returnType)
 *   or `'construct'` (member kind: constructor, no returnType)
 * @param resolveTsdocNode - callback returning the AST node to parse TSDoc
 *   from, or `undefined` to skip TSDoc resolution
 * @param paramValidationFallbackNode - location used by `validateParamKeys`
 *   when `resolveTsdocNode` returns `undefined`
 * @param declaration - parent declaration (mutated; appended to `members`)
 * @param errorContext.node - parent node used to locate diagnostics
 * @param errorContext.kindLabel - `'interface'` or `'type'`, included in the
 *   diagnostic message
 *
 * @mutates declaration - appends a member when signatures are present;
 *   sets `partial: true` on extraction failure
 * @mutates diagnostics - adds `signature_analysis_failed` on checker error
 */
export const emitCallOrConstructSignature = (
	getSignatures: () => ReadonlyArray<ts.Signature>,
	signatureKind: 'call' | 'construct',
	resolveTsdocNode: (sig: ts.Signature) => ts.Node | undefined,
	paramValidationFallbackNode: ts.Node,
	declaration: DeclarationJsonBuild,
	checker: ts.TypeChecker,
	diagnostics: Array<Diagnostic>,
	errorContext: {node: ts.Node; kindLabel: string},
): void => {
	try {
		const signatures = getSignatures();
		if (signatures.length === 0) return;

		const memberName = signatureKind === 'call' ? '(call)' : '(construct)';
		const memberKind: MemberKind = signatureKind === 'call' ? 'function' : 'constructor';
		const member: MemberJsonBuild = {name: memberName, kind: memberKind};

		const sig = signatures[0]!;
		member.typeSignature = checker.signatureToString(sig);
		if (signatureKind === 'call') {
			member.returnType = checker.typeToString(checker.getReturnTypeOfSignature(sig));
		}

		const tsdocNode = resolveTsdocNode(sig);
		const tsdoc = tsdocNode ? parseComment(tsdocNode, tsdocNode.getSourceFile()) : undefined;
		applyToDeclaration(member, tsdoc);

		member.parameters = extractSignatureParameters(sig, checker, tsdoc?.params);
		validateParamKeys(
			tsdoc?.params,
			member.parameters,
			tsdocNode ?? paramValidationFallbackNode,
			memberName,
			diagnostics,
		);

		const sigDecl = sig.getDeclaration();
		if (ts.isFunctionLike(sigDecl) && sigDecl.typeParameters?.length) {
			member.genericParams = sigDecl.typeParameters.map(parseGenericParam);
		}

		if (signatures.length > 1) {
			member.overloads = extractOverloads(signatures, checker, tsdoc, memberName, diagnostics);
		}

		(declaration.members ??= []).push(member);
	} catch (err) {
		declaration.partial = true;
		const loc = getNodeLocation(errorContext.node);
		diagnostics.push({
			kind: 'signature_analysis_failed',
			file: loc.file,
			line: loc.line,
			column: loc.column,
			message: `Failed to analyze ${signatureKind} signatures for ${errorContext.kindLabel} "${declaration.name}": ${to_error_message(err)}`,
			severity: 'warning',
			functionName: declaration.name ?? '<default export>',
		});
	}
};
