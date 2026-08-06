/**
 * Svelte component analysis helpers.
 *
 * Extracts metadata from Svelte components using svelte2tsx transformations:
 *
 * - Component props with types and JSDoc
 * - Component-level documentation
 * - Type information
 *
 * Workflow: Transform Svelte to TypeScript via svelte2tsx, parse the transformed
 * TypeScript with the TS Compiler API, extract component-level JSDoc from original source.
 *
 * **Svelte 5 only**: The svelte2tsx output format changed significantly between versions.
 * This module requires Svelte 5+ and will throw a clear error if an older version is detected.
 * There is no Svelte 4 compatibility layer.
 *
 * @see `typescript-exports.ts` for `analyzeExports`, `extractModuleComment`
 * @see `typescript-extract-shared.ts` for `parseGenericParam`, `filterExternalProperties`
 * @see `typescript-program.ts` for `IsExternalFile`, `createIsExternalFile`
 * @see `tsdoc.ts` for `parseComment`, `applyToDeclaration`
 * @see `source.ts` for `SourceFileInfo`, `getComponentName`
 *
 * @module
 */

import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { VERSION } from 'svelte/compiler';
import { svelte2tsx } from 'svelte2tsx';
import ts from 'typescript';

import type { ComponentPropJsonInput, GenericParamJson, ParameterJsonInput } from './types.ts';
import type {
	DeclarationJsonBuild,
	DeclarationAnalysis,
	ModuleAnalysis
} from './declaration-build.ts';
import {
	parseComment,
	applyToDeclaration,
	hasDocContent,
	type TsdocParsedComment
} from './tsdoc.ts';
import { type IsExternalFile, createIsExternalFile } from './typescript-program.ts';
import {
	parseGenericParam,
	filterExternalProperties,
	getTypeSignature
} from './typescript-extract-shared.ts';
import {
	extractModuleComment,
	analyzeExports,
	warnModuleCommentNodocs
} from './typescript-exports.ts';
import { type SourceFileInfo, getComponentName, SVELTE_VIRTUAL_SUFFIX } from './source.ts';
import { type ModuleSourceOptions, extractDependencies } from './source-config.ts';
import { type Diagnostic } from './diagnostics.ts';
import { to_error_message } from './error.ts';
import { toPosixPath } from './paths.ts';

/** Resolved source map type (avoids repeating the verbose `InstanceType<...>` inline). */
type SourceMap = InstanceType<typeof TraceMap>;

/**
 * Pre-transformed Svelte virtual file data.
 *
 * Produced by `transformSvelteSource` and consumed by `analyzeSvelteModule`
 * to provide checker-backed analysis of Svelte components.
 */
export interface SvelteVirtualFile {
	/** Path used for the virtual file in the TypeScript program. */
	virtualPath: string;
	/** svelte2tsx transformed TypeScript content. */
	content: string;
	/** Source map for position mapping back to the original `.svelte` file. */
	sourceMap: SourceMap | null;
	/**
	 * Parser treatment for the virtual: `ts.ScriptKind.JS` for JS-only
	 * components (no `lang="ts"`), so the checker reads their JSDoc types —
	 * the parse tolerates the TS-only statements svelte2tsx emits (a grammar
	 * diagnostic, never surfaced) — else `ts.ScriptKind.TS`. The single
	 * encoding of the script language: `ComponentDeclarationJson.lang` is
	 * derived from it at output.
	 */
	scriptKind: ts.ScriptKind;
}

/**
 * Result of `transformSvelteSource` — a virtual file (when transform succeeded)
 * plus any ingest-time diagnostics produced during the transform.
 *
 * `virtual` is `undefined` when svelte2tsx threw; in that case `diagnostics`
 * contains a `transform_failed` entry. When the transform succeeded but source
 * map construction failed, `virtual` is populated and `diagnostics` contains a
 * `source_map_failed` entry. The session's owned-entry stores both — the
 * virtual (or `transformFailed: true` flag) and the ingest diagnostics.
 */
export interface TransformResult {
	virtual: SvelteVirtualFile | undefined;
	diagnostics: Array<Diagnostic>;
}

/**
 * Pre-transform a Svelte source file via svelte2tsx.
 *
 * Produces a `SvelteVirtualFile` containing the transformed TypeScript content
 * and source map. The virtual file can be included in a TypeScript program
 * (via `createAnalysisProgram({ virtualFiles })`) so that the checker can
 * resolve imported types, `<script module>` exports, and re-exports.
 *
 * Errors at ingest are returned via `diagnostics` rather than thrown:
 * - svelte2tsx throws → `transform_failed`, `virtual: undefined`
 * - source map construction fails → `source_map_failed`, virtual populated
 *
 * Diagnostic file paths are the original `.svelte` source ID; downstream
 * normalization rewrites them to project-root-relative form.
 *
 * @param sourceFile - the Svelte source file with content loaded
 * @returns virtual file data (or `undefined` on transform failure) plus ingest diagnostics
 * @throws Error if Svelte version is below 5 (checked once on first call)
 */
export const transformSvelteSource = (sourceFile: SourceFileInfo): TransformResult => {
	assertSvelteVersion();

	// Defensively posixify the id so direct callers (power users invoking
	// `transformSvelteSource` outside an `AnalysisSession`) can't slip a
	// backslash id through and produce a backslash `virtualPath` that
	// mismatches POSIX-keyed virtual maps downstream. No-op when the session
	// already posixified at ingest.
	const posixId = toPosixPath(sourceFile.id);
	const diagnostics: Array<Diagnostic> = [];
	const isTsFile = /lang\s*=\s*["']ts["']/.test(sourceFile.content);

	let tsResult: ReturnType<typeof svelte2tsx>;
	try {
		tsResult = svelte2tsx(sourceFile.content, {
			filename: posixId,
			isTsFile,
			emitOnTemplateError: true
		});
	} catch (err) {
		diagnostics.push({
			kind: 'transform_failed',
			file: posixId,
			message: `svelte2tsx failed to transform Svelte source: ${to_error_message(err)}`,
			severity: 'error'
		});
		return { virtual: undefined, diagnostics };
	}

	const virtualPath = posixId + SVELTE_VIRTUAL_SUFFIX;

	let sourceMap: SourceMap | null = null;
	try {
		sourceMap = new TraceMap(tsResult.map as unknown as ConstructorParameters<typeof TraceMap>[0]);
	} catch (err) {
		diagnostics.push({
			kind: 'source_map_failed',
			file: posixId,
			message: `Failed to parse svelte2tsx source map: ${to_error_message(err)}. Line/column positions for this file will reference virtual TypeScript output instead of the original Svelte source.`,
			severity: 'warning'
		});
	}

	return {
		virtual: {
			virtualPath,
			content: tsResult.code,
			sourceMap,
			scriptKind: isTsFile ? ts.ScriptKind.TS : ts.ScriptKind.JS
		},
		diagnostics
	};
};

/**
 * svelte2tsx generated identifier names (magic strings from svelte2tsx output).
 * These are implementation details of svelte2tsx that we rely on for props extraction.
 */
const SVELTE2TSX_IDENTIFIERS = {
	/** Type alias containing component props in non-generic components. */
	COMPONENT_PROPS: '$$ComponentProps',
	/** Function containing props type in generic components. */
	RENDER_FUNCTION: '$$render',
	/** Class declaration for generic components. */
	RENDER_CLASS: '__sveltets_Render',
	/** Function call marking bindable props. */
	BINDINGS_FUNCTION: '__sveltets_$$bindings',
	/** Identifier for `$props()` rune. */
	PROPS_RUNE: '$props',
	/** Identifier for `$bindable()` rune. */
	BINDABLE_RUNE: '$bindable',
	/** Suffix on the synthesized component const/type alias. */
	COMPONENT_ALIAS_SUFFIX: '__SvelteComponent_'
} as const;

/**
 * Lazily validated Svelte major version.
 * `null` = not yet checked, `number` = validated major version.
 */
let svelteMajorVersion: number | null = null;

/**
 * Assert Svelte 5+ is installed (lazy, runs once on first use).
 * Throws a clear error message if an older version is detected.
 */
const assertSvelteVersion = (): void => {
	if (svelteMajorVersion !== null) return;
	const [major] = VERSION.split('.');
	svelteMajorVersion = parseInt(major!, 10);
	if (svelteMajorVersion < 5) {
		throw new Error(
			`Svelte ${VERSION} detected but Svelte 5+ is required for source analysis. ` +
				`The svelte2tsx output format changed significantly between versions.`
		);
	}
};

/**
 * The svelte2tsx landmarks that component analysis reads.
 *
 * Everything the synthesized `ComponentDeclarationJson` needs — generics,
 * source line, doc comment — keys off these three nodes, so they're located in
 * one pass and the virtual's layout is described in one place.
 */
interface ComponentNodes {
	/** `function $$render()`, whose body is the instance `<script>`. */
	renderFunction?: ts.FunctionDeclaration;
	/** `class __sveltets_Render`, emitted for generic components. */
	renderClass?: ts.ClassDeclaration;
	/** `const <Name>__SvelteComponent_`, which carries the HTML `@component` JSDoc. */
	componentAlias?: ts.VariableStatement;
}

/** Locate the svelte2tsx landmarks in a transformed source. */
const findComponentNodes = (virtualSource: ts.SourceFile): ComponentNodes => {
	const nodes: ComponentNodes = {};
	for (const statement of virtualSource.statements) {
		if (ts.isFunctionDeclaration(statement)) {
			if (statement.name?.text === SVELTE2TSX_IDENTIFIERS.RENDER_FUNCTION) {
				nodes.renderFunction = statement;
			}
		} else if (ts.isClassDeclaration(statement)) {
			if (statement.name?.text === SVELTE2TSX_IDENTIFIERS.RENDER_CLASS) {
				nodes.renderClass = statement;
			}
		} else if (
			ts.isVariableStatement(statement) &&
			statement.declarationList.declarations.some(
				(declaration) =>
					ts.isIdentifier(declaration.name) &&
					declaration.name.text.endsWith(SVELTE2TSX_IDENTIFIERS.COMPONENT_ALIAS_SUFFIX)
			)
		) {
			nodes.componentAlias = statement;
		}
	}
	return nodes;
};

/**
 * Extract generic type parameters from Svelte component.
 *
 * svelte2tsx preserves generic parameters from the component's `generics`
 * attribute on both the `$$render` function and the `__sveltets_Render` class.
 * The class wins when both carry them — it's the later declaration.
 *
 * @returns array of `GenericParamJson`, or undefined if no generics found
 */
const extractGenericParams = (nodes: ComponentNodes): Array<GenericParamJson> | undefined => {
	const typeParameters = nodes.renderClass?.typeParameters?.length
		? nodes.renderClass.typeParameters
		: nodes.renderFunction?.typeParameters;
	return typeParameters?.length ? typeParameters.map(parseGenericParam) : undefined;
};

/**
 * Extract the original source line for the component's `<script>` tag.
 *
 * Maps the `$$render` function's position back to the original `.svelte` file
 * via the source map. Falls back to line 1 when no source map is available or
 * the mapping fails.
 */
const extractComponentSourceLine = (
	nodes: ComponentNodes,
	virtualSource: ts.SourceFile,
	sourceMap: SourceMap | null
): number => {
	if (sourceMap && nodes.renderFunction) {
		const pos = virtualSource.getLineAndCharacterOfPosition(nodes.renderFunction.getStart());
		const original = originalPositionFor(sourceMap, { line: pos.line + 1, column: pos.character });
		if (original.line !== null) {
			return original.line;
		}
	}
	return 1;
};

/**
 * Extract the content of the main `<script>` tag from Svelte source.
 *
 * Matches `<script>` with any attributes (e.g., `lang`, `generics`) but excludes
 * module scripts (`<script module>`, `<script context="module">`).
 *
 * @returns the script tag content, or undefined if no matching script tag is found
 */
export const extractScriptContent = (svelteSource: string): string | undefined =>
	findScriptContent(svelteSource, false);

/**
 * Extract the content of the module `<script>` tag from Svelte source.
 *
 * Counterpart of `extractScriptContent` with the same attribute test inverted:
 * matches only module scripts (`<script module>`, `<script context="module">`),
 * so the two partition a source's script tags consistently.
 *
 * @returns the module script tag content, or undefined if no module script is found
 */
export const extractModuleScriptContent = (svelteSource: string): string | undefined =>
	findScriptContent(svelteSource, true);

/**
 * Shared scan behind `extractScriptContent`/`extractModuleScriptContent`.
 *
 * A script tag is a module script when its attributes contain the word
 * `module` — covers Svelte 5 `<script module>` (with any `lang`) and
 * Svelte 4 `<script context="module">`.
 */
const findScriptContent = (svelteSource: string, wantModule: boolean): string | undefined => {
	const scriptRegex = /<script(\s+[^>]*)?>([^]*?)<\/script>/gi;
	let match;
	while ((match = scriptRegex.exec(svelteSource)) !== null) {
		const attrs = match[1] ?? '';
		if (/\bmodule\b/.test(attrs) === wantModule) return match[2];
	}
	return undefined;
};

/**
 * Extract `@module` comment from HTML comments in Svelte source.
 *
 * Scans all `<!-- ... -->` comments for one containing `@module` at the
 * start of a line. This allows `@component` and `@module` to coexist as
 * separate HTML comments. Works for template-only components.
 *
 * @param svelteSource - the full Svelte source code
 * @returns the cleaned module comment text, or undefined if no `@module` HTML comment found
 */
export const extractHtmlModuleComment = (svelteSource: string): string | undefined => {
	const commentRegex = /<!--([^]*?)-->/g;
	let match;
	while ((match = commentRegex.exec(svelteSource)) !== null) {
		const rawContent = match[1]!;

		// Clean: normalize CRLF, strip leading/trailing whitespace per line, trim
		const cleaned = rawContent
			.replace(/\r\n/g, '\n')
			.split('\n')
			.map((line) => line.trim())
			.join('\n')
			.trim();

		if (!cleaned) continue;

		// Check for `@module` as a proper tag (at start of line, not mentioned in prose)
		if (!/(?:^|\n)@module\b/.test(cleaned)) continue;

		// Strip the `@module` tag line and return
		const lines = cleaned.split('\n');
		const filtered = lines.filter((line) => !/^\s*@module\b/.test(line));
		const result = filtered.join('\n').trim();
		return result || undefined;
	}
	return undefined;
};

/**
 * Extract module-level comment from Svelte script content.
 *
 * Parses the script content as TypeScript and delegates to `extractModuleComment`
 * for the shared `@module` tag detection logic. Works on either script's
 * content — instance `<script>` and `<script module>` (see
 * `extractScriptContent`/`extractModuleScriptContent`).
 *
 * @param scriptContent - the content of a `<script>` or `<script module>` tag
 * @returns the cleaned module comment text, or undefined if none found
 */
export const extractSvelteModuleComment = (scriptContent: string): string | undefined => {
	// Parse the script content as TypeScript and reuse the shared extraction logic
	const sourceFile = ts.createSourceFile(
		'script.ts',
		scriptContent,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS
	);
	return extractModuleComment(sourceFile);
};

/**
 * Check if the original Svelte source contains an HTML `@component` comment.
 *
 * Only checks HTML comments (`<!-- @component ... -->`), not JSDoc in `<script>`.
 * Used for duplicate `docComment` detection.
 */
const hasHtmlComponentComment = (svelteSource: string): boolean => {
	// Match HTML comments and check for @component tag
	const commentRegex = /<!--([^]*?)-->/g;
	let match;
	while ((match = commentRegex.exec(svelteSource)) !== null) {
		const content = match[1]!;
		if (/(?:^|\n)\s*@component\b/.test(content)) return true;
	}
	return false;
};

/** A component `docComment` plus the authoring form it came from. */
interface ComponentTsdoc {
	tsdoc: TsdocParsedComment;
	/** `script` for in-script JSDoc, `html` for the `@component` comment. */
	source: 'script' | 'html';
}

/**
 * Extract component-level TSDoc comment from svelte2tsx transformed output.
 *
 * Two authoring forms reach here, searched in precedence order:
 *
 * 1. in-script JSDoc — the instance `<script>` becomes the body of the
 *    `$$render()` function, so the comment rides the props destructuring (or an
 *    earlier statement in that body)
 * 2. the HTML `@component` comment — re-emitted as JSDoc on the synthesized
 *    `<Name>__SvelteComponent_` const at the end of the virtual source
 *
 * Scoping the search to those two regions is what keeps `<script module>` out:
 * its declarations hoist above `$$render`, and a whole-file walk would take the
 * first one's JSDoc — which documents that export, not the component.
 */
const extractComponentTsdoc = (
	nodes: ComponentNodes,
	sourceFile: ts.SourceFile
): ComponentTsdoc | undefined => {
	const renderBody = nodes.renderFunction?.body;
	if (renderBody) {
		const tsdoc = findInstanceTsdoc(renderBody, sourceFile);
		if (tsdoc) return { tsdoc, source: 'script' };
	}
	if (nodes.componentAlias) {
		const tsdoc = findComponentTsdoc(nodes.componentAlias, sourceFile);
		if (tsdoc) return { tsdoc, source: 'html' };
	}
	return undefined;
};

/**
 * Find the in-script component JSDoc: the first one at or above the `$props()`
 * declaration.
 *
 * Scanning stops there so a documented local below it — a JSDoc'd `$state`
 * declaration, say — can't pass itself off as the component's own docs. A
 * component with no `$props()` call has no such boundary, so its whole body is
 * in scope.
 */
const findInstanceTsdoc = (
	renderBody: ts.Block,
	sourceFile: ts.SourceFile
): TsdocParsedComment | undefined => {
	for (const statement of renderBody.statements) {
		const tsdoc = findComponentTsdoc(statement, sourceFile);
		if (tsdoc) return tsdoc;
		if (isPropsDeclaration(statement)) return undefined;
	}
	return undefined;
};

/** Whether `initializer` is a `$props()` call. */
const isPropsCall = (initializer: ts.Expression | undefined): initializer is ts.CallExpression =>
	initializer !== undefined &&
	ts.isCallExpression(initializer) &&
	ts.isIdentifier(initializer.expression) &&
	initializer.expression.text === SVELTE2TSX_IDENTIFIERS.PROPS_RUNE;

/** Check whether a statement is the `let {...} = $props()` declaration. */
const isPropsDeclaration = (statement: ts.Statement): boolean =>
	ts.isVariableStatement(statement) &&
	statement.declarationList.declarations.some((declaration) =>
		isPropsCall(declaration.initializer)
	);

/**
 * Search `root` recursively for the first JSDoc-bearing variable declaration.
 *
 * Prop-level JSDoc rides `PropertySignature` nodes, so those are skipped;
 * `parseComment` filters module-level `@module` blocks. Type machinery is
 * gated by `hasDocContent` — a JS component's `/** @type {Props} *\/`
 * annotation (or the one svelte2tsx synthesizes for untyped `$props()`)
 * parses to an empty result and would otherwise claim the doc slot, masking
 * the HTML `@component` fallback.
 */
const findComponentTsdoc = (
	root: ts.Node,
	sourceFile: ts.SourceFile
): TsdocParsedComment | undefined => {
	let foundTsdoc: TsdocParsedComment | undefined = undefined;

	const visit = (node: ts.Node): void => {
		if (foundTsdoc) return; // already found, stop searching

		// prop-level JSDoc, not component-level
		if (ts.isPropertySignature(node)) return;

		if (ts.isVariableStatement(node) || ts.isVariableDeclaration(node)) {
			const tsdoc = parseComment(node, sourceFile);
			if (tsdoc && hasDocContent(tsdoc)) {
				foundTsdoc = tsdoc;
				return;
			}
		}

		ts.forEachChild(node, visit);
	};

	visit(root);
	return foundTsdoc;
};

/**
 * Map a virtual file position back to the original `.svelte` file via source map.
 *
 * @returns mapped `{line, column}` (1-based), falling back to virtual file positions when unmappable
 */
const mapVirtualPosition = (
	node: ts.Node,
	sourceFile: ts.SourceFile,
	sourceMap: SourceMap | null
): { line: number | undefined; column: number | undefined } => {
	const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
	if (sourceMap) {
		const original = originalPositionFor(sourceMap, { line: line + 1, column: character });
		if (original.line !== null) {
			return { line: original.line, column: original.column + 1 };
		}
	}
	return { line: line + 1, column: character + 1 };
};

/**
 * Assemble a `ComponentPropJsonInput` from extracted metadata.
 */
const assemblePropInfo = (
	propName: string,
	typeString: string,
	optional: boolean,
	propDecl: ts.Node | undefined,
	metadata: PropsMetadata,
	parameters?: Array<ParameterJsonInput>
): ComponentPropJsonInput => {
	const tsdoc = propDecl ? parseComment(propDecl) : undefined;

	const result: ComponentPropJsonInput = {
		name: propName,
		type: typeString,
		optional,
		description: tsdoc?.text || undefined,
		// Default value: AST first (source of truth), then @default tag (fallback)
		defaultValue: metadata.propsDefaults.get(propName) ?? tsdoc?.defaultValue,
		bindable: metadata.bindableProps.has(propName),
		examples: tsdoc?.examples,
		deprecatedMessage: tsdoc?.deprecatedMessage,
		seeAlso: tsdoc?.seeAlso,
		throws: tsdoc?.throws,
		since: tsdoc?.since
	};
	// Only set parameters when there are actual params to expose.
	// Bare Snippet/Snippet<[]> doesn't set this — consumers use the type string for detection.
	if (parameters && parameters.length > 0) {
		result.parameters = parameters;
	}
	return result;
};

/**
 * Metadata extracted from $props() patterns in svelte2tsx transformed output.
 */
interface PropsMetadata {
	/** Props marked with `$bindable()`. */
	bindableProps: Set<string>;
	/** Default values from destructuring pattern. */
	propsDefaults: Map<string, string>;
	/** The `let {...} = $props()` declaration (first match), when present. */
	propsDeclaration: ts.VariableDeclaration | undefined;
}

/**
 * Extract all props-related metadata in a single AST traversal: bindables from
 * the `__sveltets_$$bindings(...)` call, defaults from the `$props()` binding
 * pattern, and the `$props()` declaration itself (the anchor
 * `extractPropsViaChecker` resolves the props type from).
 *
 * @param virtualSource - the svelte2tsx transformed TypeScript source
 * @returns combined metadata from single traversal
 */
const extractPropsMetadata = (virtualSource: ts.SourceFile): PropsMetadata => {
	const bindableProps: Set<string> = new Set();
	const propsDefaults: Map<string, string> = new Map();
	let propsDeclaration: ts.VariableDeclaration | undefined;

	function visit(node: ts.Node) {
		// Extract bindable props from __sveltets_$$bindings call
		if (ts.isCallExpression(node)) {
			const expr = node.expression;
			if (ts.isIdentifier(expr) && expr.text === SVELTE2TSX_IDENTIFIERS.BINDINGS_FUNCTION) {
				// Extract string literal arguments
				for (const arg of node.arguments) {
					if (ts.isStringLiteral(arg)) {
						bindableProps.add(arg.text);
					}
				}
			}
		}

		// Extract the declaration + defaults from $props() call
		if (ts.isVariableDeclaration(node)) {
			if (isPropsCall(node.initializer)) {
				propsDeclaration ??= node;

				// Extract defaults from binding pattern
				if (ts.isObjectBindingPattern(node.name)) {
					for (const element of node.name.elements) {
						if (ts.isBindingElement(element) && element.initializer) {
							const propName = ts.isIdentifier(element.name) ? element.name.text : undefined;
							if (!propName) continue;

							// Skip $bindable() with no args (no default), but extract argument if present
							if (ts.isCallExpression(element.initializer)) {
								const expr = element.initializer.expression;
								if (ts.isIdentifier(expr) && expr.text === SVELTE2TSX_IDENTIFIERS.BINDABLE_RUNE) {
									// Only extract if has argument: $bindable('value') → 'value'
									if (element.initializer.arguments.length > 0) {
										const arg = element.initializer.arguments[0]!;
										// Skip $bindable(undefined) - same semantic as $bindable()
										if (!(ts.isIdentifier(arg) && arg.text === 'undefined')) {
											propsDefaults.set(propName, arg.getText());
										}
									}
									// Skip $bindable() with no args
									continue;
								}
							}

							// Skip explicit undefined (same semantic as no default)
							if (
								ts.isIdentifier(element.initializer) &&
								element.initializer.text === 'undefined'
							) {
								continue;
							}

							// Regular default value
							propsDefaults.set(propName, element.initializer.getText());
						}
					}
				}
			}
		}

		ts.forEachChild(node, visit);
	}

	visit(virtualSource);
	return { bindableProps, propsDefaults, propsDeclaration };
};

// Snippet Detection

/**
 * Check if a type string represents a `Snippet` type.
 *
 * Uses the already-resolved type string (from `checker.typeToString`) for reliable
 * detection. `Snippet` is an interface (not a type alias), so `aliasSymbol` is
 * not available — type string matching is the reliable detection path.
 */
export const isSnippetTypeString = (typeString: string): boolean => {
	return typeString === 'Snippet<[]>' || typeString.startsWith('Snippet<[');
};

/**
 * Extract structured parameters from a `Snippet<[...]>` type.
 *
 * `Snippet` is an interface, so type arguments are on `TypeReference` (accessed
 * via `checker.getTypeArguments`), not on `aliasTypeArguments` (which is only
 * for type aliases).
 *
 * Returns full `ParameterJson` input objects (with `optional` and `rest` always set)
 * for runtime consistency with `extractSignatureParameters` in `typescript-extract-shared.ts`.
 * Optional tuple elements are widened to include `undefined` like optional properties;
 * the element type is stripped via `getTypeSignature` so `optional: true`
 * carries it alone. Callers pass the bare `Snippet<...>` TypeReference — a union
 * wrapping it (optional widening, `| null`) reports no type arguments.
 *
 * @returns array of parameter info for the snippet's tuple type arguments,
 *   or `[]` for bare `Snippet` / `Snippet<[]>`
 */
export const extractSnippetParameters = (
	snippetType: ts.Type,
	checker: ts.TypeChecker
): Array<ParameterJsonInput> => {
	// Snippet<T> is an interface — type args accessed via TypeReference, not aliasTypeArguments
	const typeArgs = checker.getTypeArguments(snippetType as ts.TypeReference);
	const tupleType = typeArgs[0];
	if (!tupleType || !checker.isTupleType(tupleType)) return [];

	const tupleRef = tupleType as ts.TypeReference;
	const elementTypes = checker.getTypeArguments(tupleRef);
	if (elementTypes.length === 0) return [];

	const target = (tupleRef as unknown as { target: ts.TupleType }).target;

	const params: Array<ParameterJsonInput> = [];
	for (let i = 0; i < elementTypes.length; i++) {
		const elementType = elementTypes[i]!;
		const label = target.labeledElementDeclarations?.[i];
		const name = label && ts.isNamedTupleMember(label) ? label.name.text : `arg${i}`;
		const optional = !!(target.elementFlags[i]! & ts.ElementFlags.Optional);
		// an optional tuple element is widened to include `undefined` like an
		// optional property — strip it so `optional: true` carries it alone
		const type = getTypeSignature(elementType, checker, optional);
		params.push({ name, type, optional, rest: false });
	}
	return params;
};

/**
 * Check if a return type string matches svelte2tsx's snippet return type pattern.
 *
 * svelte2tsx transforms exported snippets into arrow functions with
 * `ReturnType<import('svelte').Snippet>` as the return type annotation.
 * The resolved return type includes `unique symbol` (from Svelte's non-exported
 * `SnippetReturn` unique symbol) intersected with the branded render message.
 * We match on both parts to avoid false positives — the branded message alone
 * could theoretically be crafted by user code, but the `unique symbol` intersection
 * cannot since `SnippetReturn` is not exported from svelte.
 */
export const isSnippetReturnType = (returnType: string): boolean => {
	return (
		returnType.includes('{@render ...} must be called with a Snippet') &&
		returnType.includes('unique symbol')
	);
};

/**
 * Synthesize a `Snippet<[...]>` type string from structured parameters.
 *
 * Used for `kind: 'snippet'` declarations where the raw svelte2tsx type
 * is implementation noise. Renders the normalized form — an optional parameter
 * as `b?: number`, matching the structured parameter fields rather than the
 * checker's widened `b?: number | undefined`.
 */
export const synthesizeSnippetTypeSignature = (parameters: Array<ParameterJsonInput>): string => {
	const inner = parameters.map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ');
	return `Snippet<[${inner}]>`;
};

// Checker-Backed Analysis

/**
 * Check if a symbol name is an internal svelte2tsx identifier.
 *
 * Filters generated identifiers that should not appear in documentation output:
 * `$$ComponentProps`, `$$render`, `__sveltets_Render`, and the synthesized
 * component class/type alias `<ComponentName>__SvelteComponent_`.
 */
const isSvelte2tsxInternal = (name: string): boolean => {
	return (
		name.startsWith('$$') ||
		name.startsWith('__sveltets_') ||
		name.endsWith(SVELTE2TSX_IDENTIFIERS.COMPONENT_ALIAS_SUFFIX)
	);
};

/**
 * Detect whether the props type accepts a `Snippet`-typed `children` prop.
 *
 * Resolves the `children` symbol on the (unfiltered) props type, strips
 * `null`/`undefined` (unconditionally, matching the prop-extraction path), and
 * checks the resulting type — including each branch of a union — against
 * `isSnippetTypeString`. Returns `false` for non-Snippet `children` (e.g.
 * `string`) and emits a `svelte_prop_failed` warning when type resolution
 * throws so the false negative is observable.
 */
const detectChildrenSnippet = (
	propsType: ts.Type,
	propsTypeNode: ts.Node,
	checker: ts.TypeChecker,
	diagnostics: Array<Diagnostic>,
	componentName: string,
	filePath: string
): boolean => {
	const childrenSym = propsType.getProperty('children');
	if (!childrenSym) return false;
	try {
		// stripped unconditionally — the optional widening and a written `| null`
		// both wrap the `Snippet` reference in a union; a union with non-nullable
		// members (e.g. `Snippet | string`) survives and hits the branch check below
		const childrenType = checker.getNonNullableType(
			checker.getTypeOfSymbolAtLocation(childrenSym, propsTypeNode)
		);
		if (isSnippetTypeString(checker.typeToString(childrenType))) return true;
		if (childrenType.isUnion()) {
			return childrenType.types.some((t) => isSnippetTypeString(checker.typeToString(t)));
		}
		return false;
	} catch (err) {
		diagnostics.push({
			kind: 'svelte_prop_failed',
			file: filePath,
			message: `Failed to resolve type for "children" in ${componentName} while detecting acceptsChildren: ${to_error_message(err)}`,
			severity: 'warning',
			componentName,
			propName: 'children'
		});
		return false;
	}
};

/**
 * Extract props from svelte2tsx output using the TypeScript checker.
 *
 * Anchors on `metadata.propsDeclaration` (located by `extractPropsMetadata`'s
 * traversal) and uses `checker.getTypeAtLocation()` to resolve the props type,
 * including imported types that are not locally defined.
 */
const extractPropsViaChecker = (
	virtualSource: ts.SourceFile,
	checker: ts.TypeChecker,
	componentName: string,
	filePath: string,
	sourceMap: SourceMap | null,
	diagnostics: Array<Diagnostic>,
	metadata: PropsMetadata,
	isExternalFile: IsExternalFile
): {
	props: Array<ComponentPropJsonInput>;
	externalTypes?: Array<string>;
	acceptsChildren: boolean;
} => {
	// Resolve the $props() declaration's type via the checker
	let propsType: ts.Type | undefined;
	let propsTypeNode: ts.Node | undefined;
	let propsTypeName: string | undefined;

	if (metadata.propsDeclaration) {
		// JS components carry the props type as JSDoc instead of a TypeNode —
		// the author's `@type {Props}`, or the `@type {$$ComponentProps}`
		// typedef svelte2tsx synthesizes for untyped destructuring. The JSDoc
		// type participates in checking because JS-lang virtuals parse with
		// `ScriptKind.JS` (see `SvelteVirtualFile.scriptKind`).
		const typeNode = metadata.propsDeclaration.type ?? ts.getJSDocType(metadata.propsDeclaration);
		if (typeNode) {
			try {
				propsType = checker.getTypeAtLocation(typeNode);
				propsTypeNode = typeNode;
				if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
					propsTypeName = typeNode.typeName.text;
				}
			} catch (_) {
				// Fall through — propsType stays undefined
			}
		}
	}

	if (!propsType || !propsTypeNode) {
		// If $props() was used with a type name but the checker couldn't resolve it,
		// emit a diagnostic (same as the legacy path)
		if (propsTypeName) {
			diagnostics.push({
				kind: 'svelte_prop_failed',
				file: filePath,
				message: `Component "${componentName}" uses $props() with type "${propsTypeName}" but the checker could not resolve it. This may indicate an incompatible svelte2tsx version.`,
				severity: 'warning',
				componentName,
				propName: propsTypeName
			});
		}
		return { props: [], acceptsChildren: false };
	}

	// Detect `acceptsChildren` via type inference: `children` must resolve to a
	// `Snippet<...>` type. Checking the symbol name alone (the previous approach)
	// misreports a non-Snippet `children` (e.g. `children: string`) as accepting
	// children. The lookup runs on the unfiltered props type so inherited
	// `children` from `SvelteHTMLElements`/`DOMAttributes` (declared as `Snippet`)
	// is honored even when its declaration lives in node_modules.
	const acceptsChildren = detectChildrenSnippet(
		propsType,
		propsTypeNode,
		checker,
		diagnostics,
		componentName,
		filePath
	);

	// Drop properties contributed by external types (node_modules / svelte's
	// element-attribute bags like `SvelteHTMLElements['li']`); those external
	// types are summarized in `intersects` rather than enumerated as props.
	const { properties, externalTypes } = filterExternalProperties(
		propsType,
		propsTypeNode,
		checker,
		isExternalFile
	);

	const props: Array<ComponentPropJsonInput> = [];

	for (const prop of properties) {
		const propDecl = prop.valueDeclaration || prop.declarations?.[0];

		// Check optionality via symbol flags (computed before type resolution
		// since the type-string path strips the widened `undefined` for optional props)
		const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0;

		// Get type string via checker
		let typeString = 'any';
		let snippetParams: Array<ParameterJsonInput> | undefined;
		try {
			const propType = checker.getTypeOfSymbolAtLocation(prop, propsTypeNode);
			// For optional properties, the checker includes `undefined` in the union.
			// Strip it to match the declared type (e.g., `number` not `number | undefined`).
			typeString = getTypeSignature(propType, checker, optional);

			// Detect Snippet type via type string, then extract structured parameters.
			// Stripped unconditionally so the extraction sees the `Snippet<...>`
			// TypeReference rather than a union wrapping it — the optional widening
			// and a written `| null` both hide the type arguments otherwise
			// (`getTypeArguments` on a union returns nothing).
			if (isSnippetTypeString(typeString)) {
				snippetParams = extractSnippetParameters(checker.getNonNullableType(propType), checker);
			}
		} catch (err) {
			// Map position if possible
			let finalLine: number | undefined;
			let finalColumn: number | undefined;
			if (propDecl && sourceMap) {
				const propSource = propDecl.getSourceFile();
				if (propSource.fileName === virtualSource.fileName) {
					({ line: finalLine, column: finalColumn } = mapVirtualPosition(
						propDecl,
						propSource,
						sourceMap
					));
				}
			}
			diagnostics.push({
				kind: 'svelte_prop_failed',
				file: filePath,
				line: finalLine,
				column: finalColumn,
				message: `Failed to resolve type for prop "${prop.name}" in ${componentName}, falling back to 'any': ${to_error_message(err)}`,
				severity: 'warning',
				componentName,
				propName: prop.name
			});
		}

		props.push(
			assemblePropInfo(prop.name, typeString, optional, propDecl, metadata, snippetParams)
		);
	}

	return { props, externalTypes, acceptsChildren };
};

/**
 * Analyze a Svelte module using checker-backed analysis.
 *
 * Requires the svelte2tsx virtual output to be included in the TypeScript program
 * (via `createAnalysisProgram({ virtualFiles })`). Provides full type resolution for:
 * - Imported prop types (`let {x}: ImportedProps = $props()`)
 * - `<script module>` exports (constants, types, re-exports)
 * - Star exports and re-exports from Svelte files
 *
 * @param sourceFile - the original Svelte source file
 * @param modulePath - module path relative to source root
 * @param checker - TypeScript type checker (from the program containing virtual files)
 * @param options - module source options for path extraction
 * @param diagnostics - diagnostics collector for non-fatal issues
 * @param program - TypeScript program containing the virtual file
 * @param virtualFile - pre-transformed virtual file data
 * @returns module analysis with declarations, re-exports, and star exports;
 *   `undefined` if the virtual file is not found in the program
 */
export const analyzeSvelteModule = (
	sourceFile: SourceFileInfo & { dependents?: ReadonlyArray<string> },
	modulePath: string,
	checker: ts.TypeChecker,
	options: ModuleSourceOptions,
	diagnostics: Array<Diagnostic>,
	program: ts.Program,
	virtualFile: SvelteVirtualFile
): ModuleAnalysis | undefined => {
	// Look up the virtual source file in the program
	const virtualTsSource = program.getSourceFile(virtualFile.virtualPath);
	if (!virtualTsSource) {
		diagnostics.push({
			kind: 'module_skipped',
			file: modulePath,
			message: `Virtual file not found in program: ${virtualFile.virtualPath}`,
			severity: 'warning',
			reason: 'not_in_program'
		});
		return undefined;
	}

	// 1. Use analyzeExports for full checker-backed analysis (same as .ts files).
	// Its `moduleComment` is undefined for virtuals — the `<script module>`
	// comment is extracted from the original source in step 4, because svelte2tsx
	// hoists instance-script imports (with their leading JSDoc) to the virtual's
	// top level, where an instance `@module` comment would masquerade as a
	// `<script module>` one.
	const {
		declarations: rawDeclarations,
		reExports,
		starExports,
		externalReExports,
		externalStarExports
	} = analyzeExports(virtualTsSource, checker, options, diagnostics);

	// 2. Filter internal svelte2tsx symbols and the default export (generated component class),
	//    and reclassify exported snippets from 'function' to 'snippet'
	const moduleDeclarations: Array<DeclarationAnalysis> = [];
	for (const d of rawDeclarations) {
		// The svelte2tsx-emitted component default export (`export default Foo__SvelteComponent_`)
		// surfaces here as `name: 'default'`. The component declaration itself is
		// synthesized fresh below — drop the auto-generated alias.
		const name = d.declaration.name;
		if (name === undefined) continue;
		if (name === 'default') continue;
		if (isSvelte2tsxInternal(name)) continue;

		// Reclassify exported snippets: svelte2tsx transforms {#snippet} + export
		// into arrow functions with ReturnType<import('svelte').Snippet> return type.
		if (d.declaration.kind === 'function' && d.declaration.returnType) {
			if (isSnippetReturnType(d.declaration.returnType)) {
				d.declaration.kind = 'snippet';
				// Synthesize a clean Snippet type string instead of the svelte2tsx noise
				const params = d.declaration.parameters ?? [];
				d.declaration.typeSignature = synthesizeSnippetTypeSignature(params);
				// Snippets don't have meaningful return types or overloads
				delete d.declaration.returnType;
				delete d.declaration.returnDescription;
				delete d.declaration.overloads;
			}
		}

		moduleDeclarations.push(d);
	}

	// 2b. Remap source lines for module-level exports using source map.
	// analyzeExports extracts sourceLine from virtual file positions — remap to original .svelte.
	if (virtualFile.sourceMap) {
		// Build name→node map from virtual source statements
		const nodesByName = new Map<string, ts.Node>();
		// Export-statement bindings (specifiers + `* as ns`), kept separate:
		// `const foo = 1; export {foo}` would otherwise collide — the
		// declaration's line should point at the const, the synthesized
		// alias's at the specifier.
		const exportNodesByName = new Map<string, ts.Node>();
		// Virtual line → export binding node, for re-export edges. Edges
		// can't be matched by name (Svelte default-slot re-keying renames
		// them), but every edge's virtual sourceLine is some binding's line.
		const exportNodesByLine = new Map<number, ts.Node>();
		const addExportNode = (name: string, node: ts.Node) => {
			exportNodesByName.set(name, node);
			const line =
				virtualTsSource.getLineAndCharacterOfPosition(node.getStart(virtualTsSource)).line + 1;
			if (!exportNodesByLine.has(line)) exportNodesByLine.set(line, node);
		};
		for (const stmt of virtualTsSource.statements) {
			if (ts.isVariableStatement(stmt)) {
				for (const decl of stmt.declarationList.declarations) {
					if (ts.isIdentifier(decl.name)) {
						nodesByName.set(decl.name.text, decl);
					}
				}
			} else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
				nodesByName.set(stmt.name.text, stmt);
			} else if (ts.isClassDeclaration(stmt) && stmt.name) {
				nodesByName.set(stmt.name.text, stmt);
			} else if (ts.isInterfaceDeclaration(stmt)) {
				nodesByName.set(stmt.name.text, stmt);
			} else if (ts.isTypeAliasDeclaration(stmt)) {
				nodesByName.set(stmt.name.text, stmt);
			} else if (ts.isEnumDeclaration(stmt)) {
				nodesByName.set(stmt.name.text, stmt);
			} else if (ts.isExportDeclaration(stmt)) {
				if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
					for (const spec of stmt.exportClause.elements) {
						addExportNode(spec.name.text, spec);
					}
				} else if (stmt.exportClause && ts.isNamespaceExport(stmt.exportClause)) {
					addExportNode(stmt.exportClause.name.text, stmt.exportClause);
				}
			}
		}

		for (const d of moduleDeclarations) {
			if (d.declaration.name === undefined) continue;
			// Synthesized aliases and namespace declarations point at their
			// export statement; everything else at its value declaration
			const fromExportStatement =
				d.declaration.aliasOf !== undefined || d.declaration.kind === 'namespace';
			const node = fromExportStatement
				? exportNodesByName.get(d.declaration.name)
				: nodesByName.get(d.declaration.name);
			if (node) {
				const mapped = mapVirtualPosition(node, virtualTsSource, virtualFile.sourceMap);
				if (mapped.line !== undefined) {
					d.declaration.sourceLine = mapped.line;
				}
			}
		}

		// Remap edge lines by virtual line (name-independent — see above)
		for (const edge of [...reExports, ...externalReExports]) {
			if (edge.sourceLine === undefined) continue;
			const node = exportNodesByLine.get(edge.sourceLine);
			if (node) {
				const mapped = mapVirtualPosition(node, virtualTsSource, virtualFile.sourceMap);
				if (mapped.line !== undefined) {
					edge.sourceLine = mapped.line;
				}
			}
		}
	}

	// 3. Synthesize component declaration
	const componentName = getComponentName(modulePath);
	const componentDecl: DeclarationJsonBuild = {
		name: componentName,
		kind: 'component'
	};

	// Propagate script language to component declaration
	if (virtualFile.scriptKind === ts.ScriptKind.JS) {
		componentDecl.lang = 'js';
	}

	const isExternalFile = createIsExternalFile(options);

	// Extract props via checker (resolves imported types)
	const propsMetadata = extractPropsMetadata(virtualTsSource);
	const {
		props,
		externalTypes,
		acceptsChildren: propsAcceptsChildren
	} = extractPropsViaChecker(
		virtualTsSource,
		checker,
		componentName,
		modulePath,
		virtualFile.sourceMap,
		diagnostics,
		propsMetadata,
		isExternalFile
	);
	if (props.length > 0) {
		componentDecl.props = props;
	}
	if (externalTypes?.length) {
		componentDecl.intersects = externalTypes;
	}

	// Determine acceptsChildren via two paths:
	// Path A: children found in props type (from extractPropsViaChecker, before external-property filtering)
	// Path B: implicit children usage in template (for components without $props() children declaration)
	let acceptsChildren = propsAcceptsChildren;
	if (!acceptsChildren) {
		// Path B: scan virtual source for __sveltets_2_ensureSnippet(children pattern
		acceptsChildren = virtualFile.content.includes('__sveltets_2_ensureSnippet(children');
	}
	if (acceptsChildren) {
		componentDecl.acceptsChildren = true;
	}

	// Locate the svelte2tsx landmarks once — generics, doc comment, and source
	// line all read from them
	const componentNodes = findComponentNodes(virtualTsSource);

	// Extract generic params
	const genericParams = extractGenericParams(componentNodes);
	if (genericParams?.length) {
		componentDecl.genericParams = genericParams;
	}

	// Extract component-level TSDoc from virtual source
	const componentTsdoc = extractComponentTsdoc(componentNodes, virtualTsSource);
	applyToDeclaration(componentDecl, componentTsdoc?.tsdoc);

	// Extract source line via source map (maps $$render back to <script> tag)
	componentDecl.sourceLine = extractComponentSourceLine(
		componentNodes,
		virtualTsSource,
		virtualFile.sourceMap
	);

	// Extract script content once for the module comment extraction in step 4.
	const scriptContent = extractScriptContent(sourceFile.content);

	// Warn if both HTML @component and script JSDoc provide docComment
	if (
		componentDecl.docComment &&
		componentTsdoc?.source === 'script' &&
		hasHtmlComponentComment(sourceFile.content)
	) {
		diagnostics.push({
			kind: 'duplicate_comment',
			commentType: 'doc_comment',
			file: modulePath,
			message:
				'Both HTML @component comment and JSDoc in <script> provide component documentation. Using JSDoc.',
			severity: 'warning'
		});
	}

	// 4. Extract module comment from original Svelte source (not virtual)
	// Priority: instance <script> @module > <script module> @module > HTML <!-- @module -->
	const instanceModuleComment = scriptContent
		? extractSvelteModuleComment(scriptContent)
		: undefined;
	const moduleScriptContent = extractModuleScriptContent(sourceFile.content);
	const scriptModuleComment = moduleScriptContent
		? extractSvelteModuleComment(moduleScriptContent)
		: undefined;
	const htmlModuleComment = extractHtmlModuleComment(sourceFile.content);
	const moduleComment = instanceModuleComment ?? scriptModuleComment ?? htmlModuleComment;

	// @nodocs has no module-level meaning — warn per misplaced comment
	warnModuleCommentNodocs(instanceModuleComment, modulePath, diagnostics);
	warnModuleCommentNodocs(scriptModuleComment, modulePath, diagnostics);
	warnModuleCommentNodocs(htmlModuleComment, modulePath, diagnostics);

	// Warn if multiple @module sources exist
	const moduleCommentSources = [
		instanceModuleComment,
		scriptModuleComment,
		htmlModuleComment
	].filter(Boolean);
	if (moduleCommentSources.length > 1) {
		diagnostics.push({
			kind: 'duplicate_comment',
			commentType: 'module_comment',
			file: modulePath,
			message: `Multiple @module comments found (${[instanceModuleComment && 'JSDoc in <script>', scriptModuleComment && 'JSDoc in <script module>', htmlModuleComment && 'HTML comment'].filter(Boolean).join(', ')}). Using first found.`,
			severity: 'warning'
		});
	}

	// 5. Combine: component declaration first (primary export), then <script module> exports
	const allDeclarations: Array<DeclarationAnalysis> = [
		{ declaration: componentDecl, nodocs: componentTsdoc?.tsdoc.nodocs === true },
		...moduleDeclarations
	];

	// 6. Extract dependencies
	const { dependencies, dependents } = extractDependencies(sourceFile, options);

	return {
		path: modulePath,
		moduleComment,
		declarations: allDeclarations,
		dependencies,
		dependents,
		starExports,
		reExports,
		externalReExports,
		externalStarExports
	};
};
