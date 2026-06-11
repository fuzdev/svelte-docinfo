/**
 * Diagnostic collection for source analysis.
 *
 * Provides structured error/warning collection during TypeScript and Svelte
 * analysis, replacing silent catch blocks with actionable diagnostics.
 *
 * ## Error Handling Contract
 *
 * The pipeline accumulates failures into the `diagnostics` array and keeps
 * going — analysis continues, declarations/members reach the output with
 * `partial: true` when extraction failed mid-flight, and the caller decides
 * how to react. Producers include type resolution failures, individual
 * member/prop extraction failures, svelte2tsx transform failures, source-map
 * construction failures, import lex / resolver failures, and duplicate
 * declarations.
 *
 * A small set of conditions still throws from public entry points — these are
 * setup-level, not per-file: missing `tsconfig.json` (`loadTsconfig`), Svelte
 * <5 detected (`transformSvelteSource`), or strict `discovery: 'exports'`
 * mode with no resolvable exports (`discoverSourceFiles`). Wrap the top-level
 * `analyze` / `analyzeFromFiles` call if you want to handle these.
 *
 * ## Usage Pattern
 *
 * ```ts
 * const {modules, diagnostics} = await analyze({sourceFiles, sourceOptions});
 *
 * if (hasErrors(diagnostics)) {
 *   for (const err of errorsOf(diagnostics)) {
 *     console.error(formatDiagnostic(err));
 *   }
 * }
 * for (const warning of warningsOf(diagnostics)) {
 *   console.warn(formatDiagnostic(warning));
 * }
 * ```
 *
 * ## Schema-Validated Plain Data
 *
 * `AnalyzeResultJson.diagnostics` is `Array<Diagnostic>` — no wrapper object,
 * no methods, no private fields. Round-trip-safe through `JSON.stringify` /
 * `z.array(Diagnostic).parse` and symmetric with `AnalyzeResultJson.modules`
 * (also Zod-validated). The full envelope is itself a Zod schema
 * (`AnalyzeResultJson` in `analyze-core.ts`) with both fields defaulting to
 * `[]`, so the whole `{modules, diagnostics}` shape round-trips through
 * `JSON.stringify(result, compactReplacer)` / `AnalyzeResultJson.parse` even
 * when one or both arrays are empty (the wire form becomes `{}` and `.parse()`
 * restores the defaults). Use the free helpers `hasErrors`, `errorsOf`,
 * `byKind` for queries; mutate the array with native `Array.push`.
 *
 * ## File Path Contract
 *
 * `Diagnostic.file` is always project-root-relative — no leading slash,
 * no `./` prefix. `analyze` / `analyzeFromFiles` normalize paths from all
 * sources (extraction, discovery, dependency resolution) before returning.
 * Consumers that need an absolute path can rejoin with `projectRoot`.
 *
 * @module
 */

import {z} from 'zod';

// ── Severity ─────────────────────────────────────────────────────────────────

/**
 * Diagnostic severity levels.
 *
 * - `'error'` — analysis failed, declaration may be incomplete or missing data
 * - `'warning'` — partial success, something seems off but analysis continued
 */
export const DiagnosticSeverity = z.enum(['error', 'warning']);
export type DiagnosticSeverity = z.infer<typeof DiagnosticSeverity>;

// ── Kind ─────────────────────────────────────────────────────────────────────

/**
 * Discriminant for `Diagnostic` variant types.
 */
export const DiagnosticKind = z.enum([
	'type_extraction_failed',
	'signature_analysis_failed',
	'class_member_failed',
	'svelte_prop_failed',
	'module_skipped',
	'module_unreadable',
	'import_parse_failed',
	'duplicate_comment',
	'misplaced_tag',
	'unknown_param',
	'source_map_failed',
	'duplicate_declaration',
	'transform_failed',
	'resolver_failed',
]);
export type DiagnosticKind = z.infer<typeof DiagnosticKind>;

// ── Variants ─────────────────────────────────────────────────────────────────

/**
 * Base diagnostic fields shared by every variant.
 *
 * `line` / `column` are 1-based and `.optional()` — absent when the diagnostic
 * has no precise source location (e.g., a module-level skip with no specific
 * AST node). Mirrors the rest of the schema's "absent = missing key" rule;
 * use `??` at the call site if you need a placeholder.
 */
const baseDiagnosticFields = {
	/**
	 * File path relative to project root (no leading slash, no `./` prefix).
	 *
	 * Normalized at every public API boundary — `session.setFile`/`setFiles`
	 * (ingest-time), `session.query` (query-time, via `analyzeCore`), and the
	 * one-shot wrappers `analyze` / `analyzeFromFiles`. Producers inside the
	 * pipeline may write absolute or virtual paths (e.g.,
	 * `Foo.svelte.__svelte2tsx__.ts`); normalization rewrites them to
	 * project-relative form before they reach consumers.
	 */
	file: z.string(),
	/** Line number (1-based), absent if location unavailable. */
	line: z.number().int().positive().optional(),
	/** Column number (1-based), absent if location unavailable. */
	column: z.number().int().positive().optional(),
	/** Human-readable description of the issue. */
	message: z.string(),
	severity: DiagnosticSeverity,
};

/**
 * Type extraction failed (e.g., complex or recursive types).
 */
export const TypeExtractionDiagnostic = z.strictObject({
	kind: z.literal('type_extraction_failed'),
	...baseDiagnosticFields,
	/** Name of the symbol whose type couldn't be extracted. */
	symbolName: z.string(),
});
export type TypeExtractionDiagnostic = z.infer<typeof TypeExtractionDiagnostic>;

/**
 * Function/method signature analysis failed.
 */
export const SignatureAnalysisDiagnostic = z.strictObject({
	kind: z.literal('signature_analysis_failed'),
	...baseDiagnosticFields,
	/** Name of the function or method. */
	functionName: z.string(),
});
export type SignatureAnalysisDiagnostic = z.infer<typeof SignatureAnalysisDiagnostic>;

/**
 * Class member analysis failed.
 */
export const ClassMemberDiagnostic = z.strictObject({
	kind: z.literal('class_member_failed'),
	...baseDiagnosticFields,
	/** Name of the class. */
	className: z.string(),
	/** Name of the member that failed. */
	memberName: z.string(),
});
export type ClassMemberDiagnostic = z.infer<typeof ClassMemberDiagnostic>;

/**
 * Svelte prop type resolution failed.
 */
export const SveltePropDiagnostic = z.strictObject({
	kind: z.literal('svelte_prop_failed'),
	...baseDiagnosticFields,
	/** Name of the component. */
	componentName: z.string(),
	/** Name of the prop. */
	propName: z.string(),
});
export type SveltePropDiagnostic = z.infer<typeof SveltePropDiagnostic>;

/**
 * Module was skipped during the analysis pass.
 *
 * Always `warning` severity — the rest of the analysis still runs and the
 * module's absence in `modules` reflects the skip. Reasons:
 *
 * - `not_in_program` — the file wasn't in the `ts.Program` (race between
 *   session ingest and `query`, or virtual file missing for a `.svelte`)
 * - `no_analyzer` — file extension didn't match any analyzer
 * - `requires_program` — Svelte file reached the non-Svelte dispatcher (caller
 *   should use the session API instead of `analyzeModule` directly)
 *
 * Discovery-time file-read failures are a separate kind: `module_unreadable`.
 */
export const ModuleSkippedDiagnostic = z.strictObject({
	kind: z.literal('module_skipped'),
	...baseDiagnosticFields,
	/** Reason the module was skipped. */
	reason: z.enum(['not_in_program', 'no_analyzer', 'requires_program']),
});
export type ModuleSkippedDiagnostic = z.infer<typeof ModuleSkippedDiagnostic>;

/**
 * File discovered via package.json `exports` exists but couldn't be read.
 *
 * Always `error` severity — discovery-time, emitted by `discoverFromExports`
 * when `readFile` fails (permission denied, FS error). Distinct from
 * `module_skipped` so severity is a stable per-kind property and downstream
 * consumers can route discovery failures separately from analysis-pass skips.
 */
export const ModuleUnreadableDiagnostic = z.strictObject({
	kind: z.literal('module_unreadable'),
	...baseDiagnosticFields,
});
export type ModuleUnreadableDiagnostic = z.infer<typeof ModuleUnreadableDiagnostic>;

/**
 * Import parsing failed during dependency resolution.
 */
export const ImportParseDiagnostic = z.strictObject({
	kind: z.literal('import_parse_failed'),
	...baseDiagnosticFields,
});
export type ImportParseDiagnostic = z.infer<typeof ImportParseDiagnostic>;

/**
 * Duplicate comment sources detected (e.g., both HTML and JSDoc `@module`,
 * or both HTML `@component` and JSDoc for component `docComment`).
 */
export const DuplicateCommentDiagnostic = z.strictObject({
	kind: z.literal('duplicate_comment'),
	...baseDiagnosticFields,
	/** Which comment type is duplicated. */
	commentType: z.enum(['module_comment', 'doc_comment']),
});
export type DuplicateCommentDiagnostic = z.infer<typeof DuplicateCommentDiagnostic>;

/**
 * A JSDoc tag found somewhere it has no effect.
 *
 * Two contexts emit this:
 *
 * - **Non-primary overload signature** — symbol-scope tags (`@example`,
 *   `@deprecated`, `@since`, `@see`, `@throws`, `@mutates`, `@default`,
 *   `@nodocs`) describe the function as a whole, not individual signatures.
 *   The primary signature's JSDoc feeds the parent declaration's symbol-level
 *   extraction; tags on non-primary overload signatures are silently dropped
 *   from output. This diagnostic surfaces them so authors can move them to
 *   the primary signature. `@default` and `@nodocs` are included even though
 *   overloads never carry a `defaultValue` or per-overload exclusion: their
 *   presence on a non-primary signature is always a misplacement.
 * - **Module comment** — `@nodocs` has no module-level meaning (it applies to
 *   declarations and export statements); in a `@module` comment the tag does
 *   nothing except remain verbatim in `moduleComment` text. To omit a module
 *   from analysis, use `exclude` patterns instead.
 */
export const MisplacedTagDiagnostic = z.strictObject({
	kind: z.literal('misplaced_tag'),
	...baseDiagnosticFields,
	/** The tag name without the `@` prefix (e.g., `'example'`, `'deprecated'`). */
	tagName: z.enum([
		'example',
		'deprecated',
		'since',
		'see',
		'throws',
		'mutates',
		'default',
		'nodocs',
	]),
	/**
	 * Name of the function or method whose overload carries the misplaced tag.
	 * Absent for module-comment misplacements (no enclosing symbol).
	 */
	functionName: z.string().optional(),
});
export type MisplacedTagDiagnostic = z.infer<typeof MisplacedTagDiagnostic>;

/**
 * `@param` tag references a name that doesn't match any actual parameter.
 *
 * Usually a typo (`@param argz` for parameter `args`) or stale doc after a
 * rename. The description is dropped; analysis continues.
 */
export const UnknownParamDiagnostic = z.strictObject({
	kind: z.literal('unknown_param'),
	...baseDiagnosticFields,
	/** The `@param` key that didn't match a real parameter. */
	paramName: z.string(),
	/** Name of the function or method. */
	functionName: z.string(),
});
export type UnknownParamDiagnostic = z.infer<typeof UnknownParamDiagnostic>;

/**
 * A declaration `name` appears in more than one module.
 *
 * Library docs assume a flat namespace — two modules exporting the same name
 * collide when consumers `import {name}`. Emitted at `warning` severity so
 * the analysis result remains usable; consumers who want it fatal can promote
 * via `onDuplicates: 'throw'` or by inspecting the diagnostic. The default
 * slot (`name === 'default'`) is excluded — every module owns its own.
 */
export const DuplicateDeclarationDiagnostic = z.strictObject({
	kind: z.literal('duplicate_declaration'),
	...baseDiagnosticFields,
	/** The duplicated declaration name. */
	declarationName: z.string(),
	/** Module paths where the name was defined (>= 2). */
	modules: z.array(z.string()).min(2),
});
export type DuplicateDeclarationDiagnostic = z.infer<typeof DuplicateDeclarationDiagnostic>;

/**
 * Source map parsing failed for a Svelte virtual file.
 *
 * Analysis continues using virtual-file positions, so downstream `line`/`column`
 * fields on other diagnostics may point into the svelte2tsx-generated TS rather
 * than the original `.svelte` source. Rare; usually signals a malformed or
 * incompatible svelte2tsx output.
 *
 * Emitted at ingest time by `transformSvelteSource` (in `svelte.ts`); flows
 * through `setFile`/`setFiles` ingest diagnostics rather than the analysis
 * pass.
 */
export const SourceMapFailedDiagnostic = z.strictObject({
	kind: z.literal('source_map_failed'),
	...baseDiagnosticFields,
});
export type SourceMapFailedDiagnostic = z.infer<typeof SourceMapFailedDiagnostic>;

/**
 * svelte2tsx transform threw for a `.svelte` file.
 *
 * Unrecoverable at ingest — the file's owned-entry stays in the session
 * (`virtual: undefined`, `unfilteredDeps: []`, `transformFailed: true`) so
 * `query()` can synthesize a placeholder `ModuleJson` (`partial: true`,
 * empty `declarations`). The originating error message lives in `message`;
 * this diagnostic is the authoritative cause-of-failure signal.
 */
export const TransformFailedDiagnostic = z.strictObject({
	kind: z.literal('transform_failed'),
	...baseDiagnosticFields,
});
export type TransformFailedDiagnostic = z.infer<typeof TransformFailedDiagnostic>;

/**
 * Import resolver threw while resolving a specifier.
 *
 * Distinguishes a buggy resolver from a legitimately unresolvable specifier:
 * resolvers that return `null` for unknown specifiers stay silent (the normal
 * "external package" case); resolvers that *throw* surface here so consumers
 * can fix the resolver. Recoverable — the session treats the throw as `null`
 * and continues, so analysis still runs but with a missing dependency edge.
 *
 * Emitted at ingest time by the session's resolve phase.
 */
export const ResolverFailedDiagnostic = z.strictObject({
	kind: z.literal('resolver_failed'),
	...baseDiagnosticFields,
	/** The import specifier the resolver failed on. */
	specifier: z.string(),
});
export type ResolverFailedDiagnostic = z.infer<typeof ResolverFailedDiagnostic>;

/**
 * Discriminated union of all diagnostic variants.
 */
export const Diagnostic: z.ZodDiscriminatedUnion<
	[
		typeof TypeExtractionDiagnostic,
		typeof SignatureAnalysisDiagnostic,
		typeof ClassMemberDiagnostic,
		typeof SveltePropDiagnostic,
		typeof ModuleSkippedDiagnostic,
		typeof ModuleUnreadableDiagnostic,
		typeof ImportParseDiagnostic,
		typeof DuplicateCommentDiagnostic,
		typeof MisplacedTagDiagnostic,
		typeof UnknownParamDiagnostic,
		typeof SourceMapFailedDiagnostic,
		typeof DuplicateDeclarationDiagnostic,
		typeof TransformFailedDiagnostic,
		typeof ResolverFailedDiagnostic,
	],
	'kind'
> = z.discriminatedUnion('kind', [
	TypeExtractionDiagnostic,
	SignatureAnalysisDiagnostic,
	ClassMemberDiagnostic,
	SveltePropDiagnostic,
	ModuleSkippedDiagnostic,
	ModuleUnreadableDiagnostic,
	ImportParseDiagnostic,
	DuplicateCommentDiagnostic,
	MisplacedTagDiagnostic,
	UnknownParamDiagnostic,
	SourceMapFailedDiagnostic,
	DuplicateDeclarationDiagnostic,
	TransformFailedDiagnostic,
	ResolverFailedDiagnostic,
]);
export type Diagnostic = z.infer<typeof Diagnostic>;

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Check if any error-severity diagnostics were collected.
 */
export const hasErrors = (diagnostics: Array<Diagnostic>): boolean =>
	diagnostics.some((d) => d.severity === 'error');

/**
 * Check if any warning-severity diagnostics were collected.
 */
export const hasWarnings = (diagnostics: Array<Diagnostic>): boolean =>
	diagnostics.some((d) => d.severity === 'warning');

/**
 * Get all error-severity diagnostics.
 */
export const errorsOf = (diagnostics: Array<Diagnostic>): Array<Diagnostic> =>
	diagnostics.filter((d) => d.severity === 'error');

/**
 * Get all warning-severity diagnostics.
 */
export const warningsOf = (diagnostics: Array<Diagnostic>): Array<Diagnostic> =>
	diagnostics.filter((d) => d.severity === 'warning');

/**
 * Get diagnostics of a specific kind, narrowed to the matching variant.
 */
export const byKind = <K extends DiagnosticKind>(
	diagnostics: Array<Diagnostic>,
	kind: K,
): Array<Extract<Diagnostic, {kind: K}>> =>
	diagnostics.filter((d) => d.kind === kind) as Array<Extract<Diagnostic, {kind: K}>>;

/**
 * Format a diagnostic for display.
 *
 * Assumes `diagnostic.file` is project-root-relative (the contract enforced
 * by `analyze` / `analyzeFromFiles`). The displayed path is prefixed with `./`.
 *
 * @param diagnostic - the diagnostic to format
 * @returns formatted string like `'./file.ts:10:5: error: message'`
 *
 * @example
 * ```ts
 * for (const d of errorsOf(diagnostics)) {
 *   console.error(formatDiagnostic(d));
 * }
 * ```
 */
export const formatDiagnostic = (diagnostic: Diagnostic): string => {
	const {file, line, column, severity, message} = diagnostic;
	const location =
		line !== undefined ? (column !== undefined ? `${line}:${column}` : `${line}`) : '';
	const filePart = location ? `./${file}:${location}` : `./${file}`;
	return `${filePart}: ${severity}: ${message}`;
};
