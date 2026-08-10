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
	TypeJson
} from './types.ts';
import type { DeclarationJsonBuild, MemberJsonBuild } from './declaration-build.ts';
import { type Diagnostic, type MisplacedTagDiagnostic } from './diagnostics.ts';
import { to_error_message } from './error.ts';
import { stripVirtualSuffix } from './source.ts';
import { applyToDeclaration, parseComment, type TsdocParsedComment } from './tsdoc.ts';
import {
	specifierExportedName,
	optionalWideningTarget,
	resolveTypeInfo,
	type AliasRegistry
} from './typescript-extract-type-json.ts';
import { type IsExternalFile } from './typescript-program.ts';

/**
 * The pass-scoped, cross-cutting state one extraction run threads through the
 * extractor seams — `analyzeDeclaration` down to the `resolveTypeInfo` call
 * sites. Constructed once per module walk (`analyzeExports`,
 * `analyzeSvelteModule`) or per direct call (tests, fixture harnesses).
 *
 * Membership is deliberately tight: only state that is constant for the pass
 * and consumed across extractor boundaries belongs here. Per-declaration
 * inputs (nodes, symbols, parsed TSDoc, written annotations, names) stay
 * positional parameters.
 */
export interface ExtractContext {
	checker: ts.TypeChecker;
	/** Accumulator for non-fatal issues — mutated via `Array.push` throughout the pass. */
	diagnostics: Array<Diagnostic>;
	/** Predicate for external source files (node_modules, out-of-tree declarations). */
	isExternalFile: IsExternalFile;
	/**
	 * Identity-keyed registry of the analyzed set's exported alias-lost type
	 * aliases (`buildAliasRegistry` in `typescript-alias-registry.ts`), or
	 * `undefined` when no pre-pass ran — registry recovery is then disabled
	 * while written-name recovery keeps working. A required field so every
	 * construction site decides explicitly.
	 */
	aliasRegistry: AliasRegistry | undefined;
}

/**
 * Whether any of the symbol's declarations lives in `fileName`
 * (virtual-suffix-normalized).
 *
 * Merged symbols (module augmentation, declaration merging) can have
 * declarations in several files — a symbol counts as declared in the file
 * when at least one declaration is, so checking a single declaration node
 * would drop locally-declared exports depending on bind order. Symbols
 * without declarations are treated as declared in the file (permissive).
 *
 * @internal Shared by the export walk (`analyzeExports`) and the
 * alias-registry pre-pass (`buildAliasRegistry`) — both must skip
 * star-projected bindings the same way.
 */
export const isDeclaredInFile = (symbol: ts.Symbol, fileName: string): boolean => {
	const decls = symbol.declarations;
	if (!decls?.length) return true;
	return decls.some((d) => stripVirtualSuffix(d.getSourceFile().fileName) === fileName);
};

/**
 * The local export statement and binding node for an alias export symbol —
 * `{node, statement}` where `node` is the `ExportSpecifier` (or, for
 * `export * as ns`, the `NamespaceExport`) and `statement` its
 * `ExportDeclaration`.
 *
 * Returns `undefined` when the statement isn't in `sourceFile`: merged
 * symbols can put a foreign declaration first, and parsing JSDoc or
 * positions there would attribute another module's content here.
 *
 * @internal Shared by the export walk (`analyzeExports`) and the
 * alias-registry pre-pass (`buildAliasRegistry`).
 */
export const getLocalExportStatement = (
	exportSymbol: ts.Symbol,
	sourceFile: ts.SourceFile
):
	| { node: ts.ExportSpecifier | ts.NamespaceExport; statement: ts.ExportDeclaration }
	| undefined => {
	const node = exportSymbol.declarations?.[0];
	if (!node) return undefined;
	if (ts.isExportSpecifier(node)) {
		const statement = node.parent.parent;
		if (statement.getSourceFile() !== sourceFile) return undefined;
		return { node, statement };
	}
	if (ts.isNamespaceExport(node)) {
		const statement = node.parent;
		if (statement.getSourceFile() !== sourceFile) return undefined;
		return { node, statement };
	}
	return undefined;
};

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
 * Select the declaration node that carries a symbol's documented meaning.
 *
 * Mirrors `inferDeclarationKind`'s flag priority. A symbol can merge value and
 * type meanings — `const Foo = ...` + `type Foo = ...` (the schema/type
 * pattern) or `const Foo` + `interface Foo` share one symbol with combined
 * flags — and there `valueDeclaration` points at the value while the flags
 * resolve a type-space kind, so value-first selection would document the
 * value's type under the type's kind. When the flags resolve type-space
 * (`interface`, `type`, `enum`), the first matching type-space declaration is
 * selected instead; value-space kinds (and unmerged symbols) keep the
 * `valueDeclaration`-first selection. The merged value meaning goes
 * undocumented under the one-declaration-per-export-name model — the type is
 * what consumers look up.
 */
export const selectDeclarationNode = (symbol: ts.Symbol): ts.Declaration | undefined => {
	// Class/Function flags win in inferDeclarationKind, so only a flag set
	// resolving type-space redirects selection
	if (!(symbol.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Function))) {
		let matches: ((node: ts.Node) => boolean) | undefined;
		if (symbol.flags & ts.SymbolFlags.Interface) {
			matches = ts.isInterfaceDeclaration;
		} else if (symbol.flags & ts.SymbolFlags.TypeAlias) {
			matches = ts.isTypeAliasDeclaration;
		} else if (symbol.flags & (ts.SymbolFlags.Enum | ts.SymbolFlags.ConstEnum)) {
			matches = ts.isEnumDeclaration;
		}
		const typeNode = matches && symbol.declarations?.find(matches);
		if (typeNode) return typeNode;
	}
	return symbol.valueDeclaration ?? symbol.declarations?.[0];
};

/** Separator the TypeScript printer emits before a top-level `undefined` union member. */
const UNDEFINED_UNION_SUFFIX = ' | undefined';

/**
 * Type signature of a declaration — for an optional one, with the implicit
 * `| undefined` widening removed. The single chokepoint pairing `optional` with the
 * strip, so a call site can't apply one without the other. The target selection
 * itself lives in `optionalWideningTarget` (in `typescript-extract-type-json.ts`),
 * shared with the `TypeJson` builder so the flat string and the tree can't drift.
 *
 * The checker widens every optional property and parameter to include `undefined`,
 * which is redundant with `optional: true` in the output. Removing it with
 * `checker.getNonNullableType` drops `null` too, so `x?: string | null` printed as
 * `"string"` and `x?: null` as `"never"` — both silently wrong. Filtering `undefined`
 * out of `type.types` and rejoining the members is no better: it loses the alias name,
 * the printer's member order, and the parens that keep function members legal.
 *
 * So `null`-bearing unions are trimmed on the printed union instead, where TypeScript
 * always emits a top-level `undefined` last — truncated unions
 * (`'a' | ... 11 more ... | undefined`) included. Every other union keeps taking
 * `getNonNullableType`, which prints an optional function type without the union parens
 * the trim would leave behind (`() => void`, not `(() => void)`).
 *
 * Applies to the structured fields only. A callable's `typeSignature` comes from
 * `checker.signatureToString`, which has no flag to omit the widening, so it renders
 * optional parameters as the checker does — `(a?: number | undefined): void`.
 *
 * A non-union optional is printed as written, since there's no widening member to
 * remove: `x?: undefined` stays `"undefined"` (stripping would leave `never`, the same
 * silent-wrong shape as the `null` cases above), and `x?: unknown` stays `"unknown"`
 * (`getNonNullableType` would answer `{}`). See `optionalWideningTarget` for the full
 * case split.
 *
 * Known limitation: under `exactOptionalPropertyTypes` the checker doesn't widen
 * optional properties at all, so a written `x?: T | undefined` (a distinct type from
 * `x?: T` in that mode) is trimmed to `T` here. The two are indistinguishable from the
 * type alone — both carry one union member whose intrinsic name is `undefined` — so
 * telling them apart needs `compilerOptions.exactOptionalPropertyTypes`, which the
 * extractors don't thread through. Parameters are unaffected: the flag governs
 * properties only.
 */
export const getTypeSignature = (
	type: ts.Type,
	checker: ts.TypeChecker,
	optional: boolean
): string => {
	const { target, dropUndefined } = optionalWideningTarget(type, checker, optional);
	const printed = checker.typeToString(target);
	// no `undefined` member to trim when `strictNullChecks` is off
	return dropUndefined && printed.endsWith(UNDEFINED_UNION_SUFFIX)
		? printed.slice(0, -UNDEFINED_UNION_SUFFIX.length)
		: printed;
};

/**
 * The type of an optional declaration with the widening `undefined` member removed —
 * the counterpart to `getTypeSignature`'s optional strip for structural queries.
 *
 * A union with `undefined` reports no call signatures of its own, so under
 * `strictNullChecks` an optional method (`fn?(a: string): number`) or function-typed
 * property resolves to `((a: string) => number) | undefined` and reads as non-callable,
 * silently costing it `typeSignature`, `parameters`, and `returnType`. Analogous to
 * `getNonNullableType`, but leaves `null` in place: `fn?: (() => void) | null` really
 * isn't callable, and reporting it as a function would hide the `null`.
 *
 * A `null`-free union goes through `getNonNullableType`, which rebuilds the union
 * rather than picking a member — so a union of callables
 * (`fn?: (() => void) | (() => number)`) keeps its combined call signature. A
 * `null`-bearing union is returned unchanged: `null` poisons callability regardless,
 * so there's nothing to recover by stripping `undefined` from it.
 *
 * The selection itself is `optionalWideningTarget`'s — the same owner
 * `getTypeSignature` and the `TypeJson` builder select through, so the
 * structural queries can't drift from the printed and structured outputs.
 */
export const getNonOptionalType = (type: ts.Type, checker: ts.TypeChecker): ts.Type =>
	optionalWideningTarget(type, checker, true).target;

/**
 * Extract parameters from a TypeScript signature with TSDoc descriptions and default values.
 *
 * Shared helper for extracting parameter information from both standalone functions
 * and class methods/constructors.
 *
 * @param sig - the TypeScript signature to extract parameters from
 * @param ctx - the extraction pass's context (checker + alias registry)
 * @param tsdocParams - record of parameter names to TSDoc descriptions (from `TsdocParsedComment.params`)
 * @returns array of `ParameterJson` objects
 */
export const extractSignatureParameters = (
	sig: ts.Signature,
	ctx: ExtractContext,
	tsdocParams: Record<string, string> | undefined
): Array<ParameterJson> => {
	const { checker, aliasRegistry } = ctx;
	return sig.parameters.map((param) => {
		const paramDecl = param.valueDeclaration;
		const optional = !!(paramDecl && ts.isParameter(paramDecl) && paramDecl.questionToken);

		// Get type - use declaration location if available, otherwise get declared type.
		// An optional parameter is widened to include `undefined` like an optional
		// property, and is stripped the same way so `optional` carries it alone.
		// `exactOptionalPropertyTypes` governs properties only, so it never applies here.
		let typeString = 'unknown';
		let typeInfo: TypeJson | undefined;
		if (paramDecl) {
			const paramType = checker.getTypeOfSymbolAtLocation(param, paramDecl);
			typeString = getTypeSignature(paramType, checker, optional);
			const annotation = ts.isParameter(paramDecl) ? paramDecl.type : undefined;
			typeInfo = resolveTypeInfo(paramType, checker, aliasRegistry, optional, {
				writtenNode: annotation
			});
		} else {
			const paramType = checker.getDeclaredTypeOfSymbol(param);
			typeString = checker.typeToString(paramType);
			typeInfo = resolveTypeInfo(paramType, checker, aliasRegistry, false);
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

		const rest = !!(paramDecl && ts.isParameter(paramDecl) && paramDecl.dotDotDotToken);

		const parameter: ParameterJson = {
			name: param.name,
			type: typeString,
			optional,
			rest,
			description,
			defaultValue,
			propertyDescriptions
		};
		if (typeInfo) parameter.typeInfo = typeInfo;
		return parameter;
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
	parameters: ReadonlyArray<{ name: string }>,
	declNode: ts.Node,
	functionName: string,
	diagnostics: Array<Diagnostic>
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
				functionName
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
	tsdoc: TsdocParsedComment
): Array<MisplacedTagDiagnostic['tagName']> => {
	const found: Array<MisplacedTagDiagnostic['tagName']> = [];
	if (tsdoc.examples?.length) found.push('example');
	if (tsdoc.deprecatedMessage !== undefined) found.push('deprecated');
	if (tsdoc.internalMessage !== undefined) found.push('internal');
	if (tsdoc.since) found.push('since');
	if (tsdoc.seeAlso?.length) found.push('see');
	if (tsdoc.throws?.length) found.push('throws');
	if (tsdoc.mutates && Object.keys(tsdoc.mutates).length > 0) found.push('mutates');
	if (tsdoc.defaultValue !== undefined) found.push('default');
	if (tsdoc.nodocs) found.push('nodocs');
	return found;
};

/**
 * Set `returnType` + `returnTypeInfo` on a build target from a signature's
 * return type — the one projection of the flat/structured return pair, so the
 * two fields always print from the same `ts.Type` (returns are never
 * `optional`, hence the constant `false`). The written return annotation, when
 * one exists, feeds the tree's name recovery for aliases TypeScript dropped.
 */
const applyReturnType = (
	target: { returnType?: string; returnTypeInfo?: TypeJson },
	sig: ts.Signature,
	ctx: ExtractContext
): void => {
	const { checker } = ctx;
	const returnType = checker.getReturnTypeOfSignature(sig);
	target.returnType = checker.typeToString(returnType);
	// a JSDoc signature's `type` is a return *tag*, not a TypeNode
	const decl = sig.declaration;
	const returnNode = decl && !ts.isJSDocSignature(decl) ? decl.type : undefined;
	const returnTypeInfo = resolveTypeInfo(returnType, checker, ctx.aliasRegistry, false, {
		writtenNode: returnNode
	});
	if (returnTypeInfo) target.returnTypeInfo = returnTypeInfo;
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
 * Symbol-scope tags (`@example`, `@deprecated`, `@internal`, `@since`, `@see`,
 * `@throws`, `@mutates`) describe the function as a whole and belong on the parent
 * declaration. The primary overload — the one whose JSDoc text matches the
 * parent's `docComment` — already feeds the parent's symbol-level extraction,
 * so its symbol-scope tags reach the parent through that path. On non-primary
 * overloads, symbol-scope tags would otherwise be silently dropped from
 * output; this function emits a `misplaced_tag` warning instead, pointing the
 * author at the primary signature.
 *
 * @param signatures - all call signatures from the type checker
 * @param ctx - the extraction pass's context
 * @param parentTsdoc - parsed JSDoc of the parent declaration (for primary-signature detection)
 * @param parentName - parent function/method name (for diagnostic messages)
 * @returns array of overload info objects
 */
const extractOverloads = (
	signatures: ReadonlyArray<ts.Signature>,
	ctx: ExtractContext,
	parentTsdoc: TsdocParsedComment | undefined,
	parentName: string
): Array<OverloadJsonInput> => {
	const { checker, diagnostics } = ctx;
	return signatures.map((sig) => {
		const decl = sig.getDeclaration();
		const sourceFile = decl.getSourceFile();
		const tsdoc = parseComment(decl, sourceFile);

		const typeSignature = checker.signatureToString(sig);
		const parameters = extractSignatureParameters(sig, ctx, tsdoc?.params);

		validateParamKeys(tsdoc?.params, parameters, decl, parentName, diagnostics);

		const overload: OverloadJsonInput = { typeSignature, parameters };
		applyReturnType(overload, sig, ctx);

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
						functionName: parentName
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
 * `includeReturn` is false) `returnType` / `returnTypeInfo` / `returnDescription`.
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
 * @param ctx - the extraction pass's context
 * @param tsdoc - parsed TSDoc for the target (supplies `@param`/`@returns`)
 * @param paramValidationNode - node `validateParamKeys` reports `unknown_param` against
 * @param name - target name, for diagnostic messages
 * @param includeReturn - set `false` for constructors (no return type/description)
 * @mutates target - sets typeSignature, parameters, overloads, returnType, returnTypeInfo, returnDescription
 * @mutates ctx.diagnostics - via `validateParamKeys` / `extractOverloads`
 */
export const populateCallableMember = (
	target: DeclarationJsonBuild | MemberJsonBuild,
	signatures: ReadonlyArray<ts.Signature>,
	ctx: ExtractContext,
	tsdoc: TsdocParsedComment | undefined,
	paramValidationNode: ts.Node,
	name: string,
	includeReturn = true
): void => {
	if (signatures.length === 0) return;
	const sig = signatures[0]!;

	target.typeSignature = ctx.checker.signatureToString(sig);

	if (includeReturn) {
		applyReturnType(target, sig, ctx);
		if (tsdoc?.returns) target.returnDescription = tsdoc.returns;
	}

	target.parameters = extractSignatureParameters(sig, ctx, tsdoc?.params);
	validateParamKeys(tsdoc?.params, target.parameters, paramValidationNode, name, ctx.diagnostics);

	if (signatures.length > 1) {
		target.overloads = extractOverloads(signatures, ctx, tsdoc, name);
	}
};

/**
 * The output name for a member's property-name node: the unquoted text of an
 * identifier or string/numeric literal (matching the symbol-based paths,
 * where `prop.getName()` yields `data-foo` for a written `'data-foo'`), or
 * `undefined` for computed names (runtime-dependent; the symbol paths skip
 * their `__@`-prefixed forms too).
 */
export const memberNameText = (name: ts.PropertyName): string | undefined =>
	ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
		? name.text
		: undefined;

/**
 * Populate a property-shaped member from its checker type: a callable property
 * becomes `kind: 'function'` with the full signature field set (generic
 * signatures carry `genericParams` like method signatures do), everything
 * else gets the flat/structured pair (`typeSignature` + `typeInfo`) with the
 * optional-widening strip paired to `optional` like every checker-backed site.
 * TSDoc applies here after the projection; members carry `@default` →
 * `defaultValue` whatever kind the classification settles on (for a callable
 * member it documents the behavior used when the callback is omitted).
 *
 * The one projection shared by the structural property sites — type-alias
 * properties and interface property signatures — so the same written shape
 * can't extract differently across the two container kinds. Class fields
 * deliberately don't route here: a field holding a function is still a field
 * (`kind: 'variable'`), while on the structural containers callability is the
 * member's classification.
 *
 * @param annotation - the written type annotation, when one exists (feeds `typeInfo` name recovery)
 * @mutates member - sets kind, doc fields, and either the callable field set or typeSignature/typeInfo
 * @mutates ctx.diagnostics - via `populateCallableMember`
 */
export const populatePropertyMember = (
	member: MemberJsonBuild,
	propType: ts.Type,
	ctx: ExtractContext,
	optional: boolean,
	tsdoc: TsdocParsedComment | undefined,
	paramValidationNode: ts.Node,
	name: string,
	annotation: ts.TypeNode | undefined
): void => {
	const { checker } = ctx;
	// an optional property resolves to a union with `undefined`, which reports no
	// call signatures — strip it so `fn?: () => void` still reads as a function
	const callableType = optional ? getNonOptionalType(propType, checker) : propType;
	const callSigs = callableType.getCallSignatures();
	if (callSigs.length > 0) {
		member.kind = 'function';
		populateCallableMember(member, callSigs, ctx, tsdoc, paramValidationNode, name);
		// generic signatures carry genericParams like method signatures and
		// (call) members do — read from the primary signature's declaration
		const sigDecl = callSigs[0]!.getDeclaration();
		if (ts.isFunctionLike(sigDecl) && sigDecl.typeParameters?.length) {
			member.genericParams = sigDecl.typeParameters.map(parseGenericParam);
		}
	} else {
		member.typeSignature = getTypeSignature(propType, checker, optional);
		const typeInfo = resolveTypeInfo(propType, checker, ctx.aliasRegistry, optional, {
			writtenNode: annotation
		});
		if (typeInfo) member.typeInfo = typeInfo;
	}
	// owning the apply here keeps projection + docs a single call for both
	// container kinds
	applyToDeclaration(member, tsdoc, true);
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
	isExternalFile: IsExternalFile
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
	typeNode: ts.Node
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
 * Determine whether a type-reference / indexed-access / heritage node names a
 * type whose properties all come from external files (e.g.
 * `SvelteHTMLElements['li']`, `HTMLAttributes<HTMLDivElement>`). Such a node is
 * an external attribute "bag" that should be summarized in `externalTypes` rather
 * than enumerated as members.
 *
 * Mirrors the per-property origin test used for membership: external only when
 * the node has at least one property and every property is external. A
 * zero-property branch (e.g. a pure index signature) is not surfaced — there is
 * no named member to attribute to it.
 */
const isExternalTypeRefNode = (
	node: ts.TypeNode,
	checker: ts.TypeChecker,
	isExternalFile: IsExternalFile
): boolean => {
	const props = checker.getTypeAtLocation(node).getProperties();
	return props.length > 0 && props.every((p) => isExternalProperty(p, isExternalFile));
};

/**
 * Append an external type's text, ignoring a repeat.
 *
 * Two local branches composing one bag reach the same text twice (`interface
 * Props extends A, B` where both extend it). `externalTypes` is a display list
 * of distinct contributors, so the first occurrence wins and source order holds.
 *
 * @mutates out - appends `text` when not already present
 */
const pushExternalTypeRef = (out: Array<string>, text: string): void => {
	if (!out.includes(text)) out.push(text);
};

/**
 * Resolve an identifier written as an *import rename* to the name its module
 * exports, or `undefined` when the spelling is already the importable one —
 * an unrenamed import, a default or namespace import (no exported name to
 * recover), or anything that isn't an import at all.
 *
 * The exported name comes from `specifierExportedName`, shared with the
 * written-name recovery channel in `typescript-extract-type-json.ts`; the
 * difference here is only that a substitution has nothing to do when the
 * spelling already matches. That is also why the shared rule's export-specifier
 * arm never fires here: it answers with the specifier's own published name,
 * which is what an identifier reaching it was already spelled as.
 */
const importedNameOf = (id: ts.Identifier, checker: ts.TypeChecker): string | undefined => {
	const symbol = checker.getSymbolAtLocation(id);
	if (!symbol) return undefined;
	const name = specifierExportedName(symbol);
	return name === undefined || name === id.text ? undefined : name;
};

/**
 * Render a leaf reference node as text that means the same thing at the
 * documented site as it does where it was written.
 *
 * Descent collects verbatim text from *definition* sites, which spell imported
 * names however that file chose to: `import type {Bag as B} from 'pkg'` beside
 * `interface Props extends B` puts `B` in hand, a name bound nowhere the
 * documented declaration can see. Each renamed identifier is substituted back
 * to the name its module exports, so entries are resolvable wherever they
 * surface — and one bag spelled two ways across two files (`Bag` here, `B`
 * there) collapses to one entry under `pushExternalTypeRef`'s dedupe rather
 * than reading as two contributors.
 *
 * Substitution is textual rather than a reprint of the type: the written form
 * is what `externalTypes` carries (generic arguments and index-access shape
 * included), and inference erases exactly that.
 */
const externalTypeRefText = (node: ts.TypeNode, checker: ts.TypeChecker): string => {
	const text = node.getText();
	const offset = node.getStart();
	// collected in source order, applied back to front so earlier edits keep
	// their offsets
	const edits: Array<{ start: number; end: number; name: string }> = [];
	const visit = (n: ts.Node): void => {
		if (ts.isIdentifier(n)) {
			const name = importedNameOf(n, checker);
			if (name !== undefined) {
				edits.push({ start: n.getStart() - offset, end: n.getEnd() - offset, name });
			}
		}
		ts.forEachChild(n, visit);
	};
	visit(node);
	if (edits.length === 0) return text;
	let out = text;
	for (let i = edits.length - 1; i >= 0; i--) {
		const edit = edits[i]!;
		out = out.slice(0, edit.start) + edit.name + out.slice(edit.end);
	}
	return out;
};

/**
 * Determine whether a node's written text references a type parameter bound
 * inside the current descent — declared by a declaration on the `seen` path.
 *
 * Descent collects verbatim text from *definition* sites, and a generic
 * definition's text can name its own type parameters: `interface A<T> extends
 * ExtG<T> {}` reached via `Props extends A<string>` puts `ExtG<T>` in hand,
 * where `T` resolves to nothing at the documented annotation site. Such text is
 * malformed there, worse than no entry, so emission skips it and recovery
 * degrades to the nearest enclosing reference whose text is well-formed.
 *
 * A type parameter declared *outside* the descent stays emittable: a generic
 * component's own param in `interface Props extends HTMLAttributes<T>` is in
 * scope at the annotation site (documented in `genericParams`), and its
 * declaring node is never on the `seen` path.
 */
// TODO: substitute written type args through the descent (or move to a
// checker `getBaseTypes()` walk) so `A<string>` over `extends ExtG<T>` can
// emit the instantiated `ExtG<string>` instead of degrading to the outer name
const referencesTypeParamBoundInDescent = (
	node: ts.Node,
	checker: ts.TypeChecker,
	seen: ReadonlySet<ts.Declaration>
): boolean => {
	if (seen.size === 0) return false;
	let found = false;
	const visit = (n: ts.Node): void => {
		if (found) return;
		if (ts.isIdentifier(n)) {
			const paramDecl = checker
				.getSymbolAtLocation(n)
				?.getDeclarations()
				?.find(ts.isTypeParameterDeclaration);
			const owner = paramDecl?.parent;
			if (
				owner &&
				(ts.isInterfaceDeclaration(owner) || ts.isTypeAliasDeclaration(owner)) &&
				seen.has(owner)
			) {
				found = true;
				return;
			}
		}
		ts.forEachChild(n, visit);
	};
	visit(node);
	return found;
};

/**
 * Declaration boundaries the local-composition descent crosses before giving
 * up. `seen` already terminates cycles; this bounds a long acyclic chain of
 * distinct local aliases, matching the alias registry's containment walk.
 */
const MAX_COMPOSITION_DEPTH = 10;

/**
 * Walk the composition a project-local name hides behind it, collecting the
 * external references it reaches.
 *
 * A local interface composes through its heritage entries — `interface Props
 * extends HTMLButtonAttributes` inherits the bag's properties, and membership
 * filtering drops them exactly like an intersection branch's, so the bag belongs
 * in `externalTypes` the same way. A local type alias composes through its
 * right-hand side, for the same reason one level down. Merged interface
 * declarations each contribute.
 *
 * External declarations contribute nothing: an external name reads as a single
 * bag rather than leaking its node_modules-internal definition, which is what
 * the caller emits for it when this walk comes back empty.
 *
 * `seen` is scoped to the current path — a declaration is released once its own
 * composition is walked — so a name can't contain itself (cyclic `extends`
 * terminates) while two branches sharing an intermediate each still reach
 * through it. `depth` counts declaration boundaries crossed and bounds a chain
 * no cycle terminates (each hop a distinct declaration). Past the cap the
 * reference in hand is treated as untraversable, so it falls back to its own
 * text — for a long chain of local aliases that means a local name from
 * partway down rather than the external bag behind it, the same degradation a
 * mapped or conditional definition gets.
 *
 * @mutates out - appends each external reference's text, deduplicated by text
 * @mutates seen - holds the declarations on the current path for the duration of their walk
 */
const collectFromLocalComposition = (
	node: ts.TypeNode,
	checker: ts.TypeChecker,
	isExternalFile: IsExternalFile,
	out: Array<string>,
	seen: Set<ts.Declaration>,
	depth: number
): void => {
	if (depth > MAX_COMPOSITION_DEPTH) return;
	// a type reference names its type through `typeName` and a heritage entry
	// through `expression`; an indexed access has no name to resolve
	const nameNode = ts.isTypeReferenceNode(node)
		? node.typeName
		: ts.isExpressionWithTypeArguments(node)
			? node.expression
			: undefined;
	if (!nameNode) return;
	// an imported name resolves to its `ImportSpecifier` first — follow the alias
	// so the declaration inspected below is the type's own, in its own file
	let symbol = checker.getSymbolAtLocation(nameNode);
	if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
	const decls = symbol?.getDeclarations();
	if (!decls) return;

	for (const decl of decls) {
		if (isExternalFile(decl.getSourceFile()) || seen.has(decl)) continue;
		seen.add(decl);
		if (ts.isTypeAliasDeclaration(decl)) {
			collectExternalTypeRefs(decl.type, checker, isExternalFile, out, seen, depth + 1);
		} else if (ts.isInterfaceDeclaration(decl)) {
			// an interface's only heritage clause kind is `extends`
			for (const clause of decl.heritageClauses ?? []) {
				for (const base of clause.types) {
					collectExternalTypeRefs(base, checker, isExternalFile, out, seen, depth + 1);
				}
			}
		}
		seen.delete(decl);
	}
};

/**
 * Walk a written type node and collect, in source order, the verbatim text of
 * every external type reference it composes.
 *
 * Structure is read from the AST rather than the inferred type because
 * inference erases it: `(A | B) & C` normalizes to a union and `X['k']`
 * flattens to a property bag, both losing the `&`/`|`/index-access shape the
 * author wrote. Composition nodes (intersection, union, parenthesized) recurse.
 * Inline object literals and other local shapes contribute no entry.
 *
 * A leaf reference (`TypeReference`, `IndexedAccessType`, or an interface
 * heritage entry) descends first: whatever bags its *local* composition reaches
 * are what it contributes, so a bag behind `interface Props extends Bag` or
 * behind a local alias is recorded like an inline `Bag & {…}` branch. The
 * property filtering this pairs with is inheritance-blind, so the label
 * collection has to be too. Only when that descent comes back empty — an
 * external name, or a local one whose definition is a shape the walk can't
 * traverse (mapped, conditional, an instantiated utility type) — does the leaf
 * fall back to emitting its own text, and then only if it is wholly external
 * (`isExternalTypeRefNode`) and free of type parameters bound inside the
 * descent (`referencesTypeParamBoundInDescent` — a generic base's heritage
 * text can name the base's own params, which dangle at the documented site).
 *
 * Descending in preference to the name is what keeps a *local* name out of a
 * field documented as naming external contributors: an attribute-forwarding
 * `interface Props extends Bag {}` records `Bag`, not `Props`.
 *
 * A leaf's text is emitted through `externalTypeRefText`, which resolves the
 * import renames its definition site may have spelled it with.
 *
 * @mutates out - appends each external reference's text, deduplicated by text
 * @mutates seen - holds the declarations on the current path for the duration of their walk
 */
const collectExternalTypeRefs = (
	node: ts.TypeNode,
	checker: ts.TypeChecker,
	isExternalFile: IsExternalFile,
	out: Array<string>,
	seen: Set<ts.Declaration>,
	depth: number
): void => {
	if (ts.isParenthesizedTypeNode(node)) {
		collectExternalTypeRefs(node.type, checker, isExternalFile, out, seen, depth);
	} else if (ts.isIntersectionTypeNode(node) || ts.isUnionTypeNode(node)) {
		for (const branch of node.types) {
			collectExternalTypeRefs(branch, checker, isExternalFile, out, seen, depth);
		}
	} else if (
		ts.isTypeReferenceNode(node) ||
		ts.isIndexedAccessTypeNode(node) ||
		ts.isExpressionWithTypeArguments(node)
	) {
		// collected apart from `out` so "the descent found nothing" stays
		// distinguishable from "it found only what a sibling branch already did"
		const descended: Array<string> = [];
		collectFromLocalComposition(node, checker, isExternalFile, descended, seen, depth);
		if (descended.length) {
			for (const text of descended) pushExternalTypeRef(out, text);
		} else if (
			!referencesTypeParamBoundInDescent(node, checker, seen) &&
			isExternalTypeRefNode(node, checker, isExternalFile)
		) {
			pushExternalTypeRef(out, externalTypeRefText(node, checker));
		}
	}
};

/**
 * Resolve a props/type-alias annotation node to the written type node whose
 * structure drives `externalTypes` extraction.
 *
 * The svelte2tsx props annotation is a reference to a generated `$$ComponentProps`
 * alias; unwrap one level of *local* type-alias reference so the underlying
 * composition (`SvelteHTMLElements['li']`, `(A | B) & C`, …) is visible. External
 * alias references are left intact so they read as a single named bag rather than
 * leaking their node_modules-internal definition. Type-alias callers pass the
 * written node directly, so for them this is a no-op.
 *
 * `collectExternalTypeRefs` descends through local names on its own, so this is
 * belt-and-braces for the root position rather than the only way a generated
 * alias is seen through.
 */
const resolveAnnotationTypeNode = (
	typeNode: ts.Node,
	checker: ts.TypeChecker,
	isExternalFile: IsExternalFile
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
 * local and kept. The labels naming the dropped contributors come from an AST
 * walk (`collectExternalTypeRefs`) — the authoritative source for the
 * `&`/`|`/index-access shape inference would otherwise erase — which descends
 * through project-local names so a bag inherited via `interface Props extends
 * Bag` is labeled like an inline `Bag & {…}` branch.
 */
export const filterExternalProperties = (
	type: ts.Type,
	typeNode: ts.Node,
	checker: ts.TypeChecker,
	isExternalFile: IsExternalFile
): { properties: Array<ts.Symbol>; externalTypes: Array<string> } => {
	const properties = type
		.getProperties()
		.filter((prop) => !isExternalProperty(prop, isExternalFile));

	const externalTypes: Array<string> = [];
	const annotation = resolveAnnotationTypeNode(typeNode, checker, isExternalFile);
	if (annotation) {
		collectExternalTypeRefs(annotation, checker, isExternalFile, externalTypes, new Set(), 0);
	}

	return { properties, externalTypes };
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
	initializer: ts.Expression | undefined
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
export const getNodeLocation = (node: ts.Node): { file: string; line: number; column: number } => {
	const sourceFile = node.getSourceFile();
	const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
	return {
		file: sourceFile.fileName,
		line: line + 1, // Convert to 1-based
		column: character + 1 // Convert to 1-based
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
		name: param.name.text
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
	modifiers: ReadonlyArray<ts.ModifierLike> | undefined
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
 * @mutates ctx.diagnostics - adds `signature_analysis_failed` on checker error
 */
export const emitCallOrConstructSignature = (
	getSignatures: () => ReadonlyArray<ts.Signature>,
	signatureKind: 'call' | 'construct',
	resolveTsdocNode: (sig: ts.Signature) => ts.Node | undefined,
	paramValidationFallbackNode: ts.Node,
	declaration: DeclarationJsonBuild,
	ctx: ExtractContext,
	errorContext: { node: ts.Node; kindLabel: string }
): void => {
	const { checker, diagnostics } = ctx;
	try {
		const signatures = getSignatures();
		if (signatures.length === 0) return;

		const memberName = signatureKind === 'call' ? '(call)' : '(construct)';
		const memberKind: MemberKind = signatureKind === 'call' ? 'function' : 'constructor';
		const member: MemberJsonBuild = { name: memberName, kind: memberKind };

		const sig = signatures[0]!;
		member.typeSignature = checker.signatureToString(sig);
		if (signatureKind === 'call') applyReturnType(member, sig, ctx);

		const tsdocNode = resolveTsdocNode(sig);
		const tsdoc = tsdocNode ? parseComment(tsdocNode, tsdocNode.getSourceFile()) : undefined;
		applyToDeclaration(member, tsdoc, true);

		member.parameters = extractSignatureParameters(sig, ctx, tsdoc?.params);
		validateParamKeys(
			tsdoc?.params,
			member.parameters,
			tsdocNode ?? paramValidationFallbackNode,
			memberName,
			diagnostics
		);

		const sigDecl = sig.getDeclaration();
		if (ts.isFunctionLike(sigDecl) && sigDecl.typeParameters?.length) {
			member.genericParams = sigDecl.typeParameters.map(parseGenericParam);
		}

		if (signatures.length > 1) {
			member.overloads = extractOverloads(signatures, ctx, tsdoc, memberName);
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
			functionName: declaration.name ?? '<default export>'
		});
	}
};
