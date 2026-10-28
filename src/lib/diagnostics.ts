/**
 * Diagnostic collection for source analysis.
 *
 * Structured error/warning collection during TypeScript and Svelte analysis.
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
 * A few conditions still throw from the public entry points. These are
 * configuration and environment errors, not per-file failures: invalid or
 * contradictory options (see the `@throws` on `createSourceOptions` and
 * `discoverSourceFiles`), a missing or unloadable `tsconfig.json` (including
 * an unresolved `extends`, see `loadTsconfig`), Svelte <5, and failed
 * strict `'exports'` discovery. `onDuplicates: 'throw'` also throws, by
 * request. Wrap the top-level call to handle these.
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
 * `parseDiagnostics` and symmetric with `AnalyzeResultJson.modules` (also
 * schema-validated). The full envelope is itself a valibot schema
 * (`AnalyzeResultJson` in `analyze-core.ts`) with both fields defaulting to
 * `[]`, so the whole `{modules, diagnostics}` shape round-trips through
 * `JSON.stringify(result, compactReplacer)` / `parseAnalyzeResult` even when
 * one or both arrays are empty (the wire form becomes `{}` and parsing
 * restores the defaults). Use the free helpers `hasErrors`, `errorsOf`,
 * `byKind` for queries; mutate the array with native `Array.push`.
 *
 * ## File Path Contract
 *
 * `Diagnostic.file` is always project-root-relative — no leading slash,
 * no `./` prefix. `analyze` / `analyzeFromFiles` and the session
 * (`setFile`/`setFiles` at ingest, `query` at analysis) normalize paths from
 * all sources (extraction, discovery, dependency resolution) before
 * returning. Consumers that need an absolute path can rejoin with
 * `projectRoot` — a file outside the root takes the `../` form, so the rejoin
 * holds for it too.
 *
 * It names a *file*, not a module: `ModuleJson.path` is relative to
 * `sourceRoot`, so `file` is not a lookup key into `modules`.
 *
 * @module
 */

import * as v from 'valibot';

import { parseWithSummary, type Named } from './schema.ts';

// Severity

/**
 * Diagnostic severity levels.
 *
 * - `'error'` — analysis failed, declaration may be incomplete or missing data
 * - `'warning'` — partial success, something seems off but analysis continued
 */
export const DiagnosticSeverity = v.picklist(['error', 'warning']);
export type DiagnosticSeverity = v.InferOutput<typeof DiagnosticSeverity>;

// Kind

/**
 * Discriminant for `Diagnostic` variant types.
 *
 * Severity is a stable per-kind property: `transform_failed` and
 * `module_unreadable` are always `error`, every other kind always `warning`.
 */
export const DiagnosticKind = v.picklist([
	'type_extraction_failed',
	'signature_analysis_failed',
	'class_member_failed',
	'svelte_prop_failed',
	'module_skipped',
	'module_unreadable',
	'import_parse_failed',
	'duplicate_comment',
	'component_comment_mismatch',
	'misplaced_tag',
	'implementation_doc_hidden',
	'unknown_param',
	'unknown_cssprop',
	'malformed_tag',
	'duplicate_tag',
	'cssprop_default_mismatch',
	'source_map_failed',
	'duplicate_declaration',
	'transform_failed',
	'resolver_failed',
	'alias_lost',
	'commonjs_unsupported',
	'css_parse_failed',
	'css_lang_unsupported'
]);
export type DiagnosticKind = v.InferOutput<typeof DiagnosticKind>;

// Variants

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
	 *
	 * The exception is **discovery** — `discoverSourceFiles` /
	 * `discoverFromExports` return their diagnostics unnormalized, since they
	 * run before any session exists. Their `file` is already
	 * project-root-relative, but `message` can embed an absolute path (an fs
	 * error names the file it failed on), so a consumer wiring discovery up
	 * itself owns the `normalizeDiagnosticPaths` call — `analyzeFromFiles` and
	 * the Vite plugin both make it before merging.
	 *
	 * **The absolute form is the one to write.** Normalization deliberately
	 * leaves an already-relative path alone (relativizing it would resolve
	 * against `cwd`), so a producer writing a `ModuleJson.path` — relative to
	 * `sourceRoot`, a different base — passes through untouched and publishes
	 * the same file under a second name. Absolute is what the pass can
	 * actually correct.
	 */
	file: v.string(),
	/** Line number (1-based), absent if location unavailable. */
	line: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(1))),
	/** Column number (1-based), absent if location unavailable. */
	column: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(1))),
	/** Human-readable description of the issue. */
	message: v.string(),
	severity: DiagnosticSeverity
};

// named through an interface for declaration emit, as in `types.ts`
const TypeExtractionDiagnosticImpl = v.strictObject({
	kind: v.literal('type_extraction_failed'),
	...baseDiagnosticFields,
	/** Name of the symbol whose type couldn't be extracted. */
	symbolName: v.string()
});
/** @nodocs */
export interface TypeExtractionDiagnosticSchema extends Named<
	typeof TypeExtractionDiagnosticImpl
> {}
/**
 * Type extraction failed (e.g., complex or recursive types).
 */
export const TypeExtractionDiagnostic: TypeExtractionDiagnosticSchema =
	TypeExtractionDiagnosticImpl;
export type TypeExtractionDiagnostic = v.InferOutput<typeof TypeExtractionDiagnostic>;

const SignatureAnalysisDiagnosticImpl = v.strictObject({
	kind: v.literal('signature_analysis_failed'),
	...baseDiagnosticFields,
	/** Name of the function or method. */
	functionName: v.string()
});
/** @nodocs */
export interface SignatureAnalysisDiagnosticSchema extends Named<
	typeof SignatureAnalysisDiagnosticImpl
> {}
/**
 * Function/method signature analysis failed.
 */
export const SignatureAnalysisDiagnostic: SignatureAnalysisDiagnosticSchema =
	SignatureAnalysisDiagnosticImpl;
export type SignatureAnalysisDiagnostic = v.InferOutput<typeof SignatureAnalysisDiagnostic>;

const ClassMemberDiagnosticImpl = v.strictObject({
	kind: v.literal('class_member_failed'),
	...baseDiagnosticFields,
	/** Name of the class. */
	className: v.string(),
	/** Name of the member that failed. */
	memberName: v.string()
});
/** @nodocs */
export interface ClassMemberDiagnosticSchema extends Named<typeof ClassMemberDiagnosticImpl> {}
/**
 * Class member analysis failed.
 */
export const ClassMemberDiagnostic: ClassMemberDiagnosticSchema = ClassMemberDiagnosticImpl;
export type ClassMemberDiagnostic = v.InferOutput<typeof ClassMemberDiagnostic>;

const SveltePropDiagnosticImpl = v.strictObject({
	kind: v.literal('svelte_prop_failed'),
	...baseDiagnosticFields,
	/** Name of the component. */
	componentName: v.string(),
	/** Name of the prop. */
	propName: v.string()
});
/** @nodocs */
export interface SveltePropDiagnosticSchema extends Named<typeof SveltePropDiagnosticImpl> {}
/**
 * Svelte prop type resolution failed.
 *
 * Also emitted once per `export let` prop of a legacy component whose
 * svelte2tsx output has no recognized props type: those props aren't
 * extracted, and each failure carries its export's line.
 *
 * `file` is the original `.svelte` path, so `line`/`column` are present only
 * when the prop's declaration lives in the component's own virtual *and* maps
 * back to the original source — an imported props type or a node svelte2tsx
 * synthesized leaves the position absent rather than publishing a virtual
 * line, the rule `remapVirtualDiagnosticPositions` applies to extractor
 * diagnostics.
 */
export const SveltePropDiagnostic: SveltePropDiagnosticSchema = SveltePropDiagnosticImpl;
export type SveltePropDiagnostic = v.InferOutput<typeof SveltePropDiagnostic>;

const ModuleSkippedDiagnosticImpl = v.strictObject({
	kind: v.literal('module_skipped'),
	...baseDiagnosticFields,
	/** Reason the module was skipped. */
	reason: v.picklist(['not_in_program', 'no_analyzer', 'requires_program'])
});
/** @nodocs */
export interface ModuleSkippedDiagnosticSchema extends Named<typeof ModuleSkippedDiagnosticImpl> {}
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
export const ModuleSkippedDiagnostic: ModuleSkippedDiagnosticSchema = ModuleSkippedDiagnosticImpl;
export type ModuleSkippedDiagnostic = v.InferOutput<typeof ModuleSkippedDiagnostic>;

const ModuleUnreadableDiagnosticImpl = v.strictObject({
	kind: v.literal('module_unreadable'),
	...baseDiagnosticFields
});
/** @nodocs */
export interface ModuleUnreadableDiagnosticSchema extends Named<
	typeof ModuleUnreadableDiagnosticImpl
> {}
/**
 * File discovered via package.json `exports` exists but couldn't be read.
 *
 * Always `error` severity — discovery-time, emitted by `discoverFromExports`
 * when `readFile` fails (permission denied, FS error). Distinct from
 * `module_skipped` so severity is a stable per-kind property and downstream
 * consumers can route discovery failures separately from analysis-pass skips.
 */
export const ModuleUnreadableDiagnostic: ModuleUnreadableDiagnosticSchema =
	ModuleUnreadableDiagnosticImpl;
export type ModuleUnreadableDiagnostic = v.InferOutput<typeof ModuleUnreadableDiagnostic>;

const ImportParseDiagnosticImpl = v.strictObject({
	kind: v.literal('import_parse_failed'),
	...baseDiagnosticFields
});
/** @nodocs */
export interface ImportParseDiagnosticSchema extends Named<typeof ImportParseDiagnosticImpl> {}
/**
 * Import scanning threw during dependency resolution.
 *
 * Not expected in practice: the parse in `lexImports` tolerates malformed
 * source rather than rejecting it, so this guards an unexpected throw.
 */
export const ImportParseDiagnostic: ImportParseDiagnosticSchema = ImportParseDiagnosticImpl;
export type ImportParseDiagnostic = v.InferOutput<typeof ImportParseDiagnostic>;

const DuplicateCommentDiagnosticImpl = v.strictObject({
	kind: v.literal('duplicate_comment'),
	...baseDiagnosticFields,
	/** Which comment type is duplicated. */
	commentType: v.picklist(['module_comment', 'doc_comment'])
});
/** @nodocs */
export interface DuplicateCommentDiagnosticSchema extends Named<
	typeof DuplicateCommentDiagnosticImpl
> {}
/**
 * Duplicate comment sources detected (e.g., both HTML and JSDoc `@module`,
 * or both HTML `@component` and JSDoc for component `docComment`).
 */
export const DuplicateCommentDiagnostic: DuplicateCommentDiagnosticSchema =
	DuplicateCommentDiagnosticImpl;
export type DuplicateCommentDiagnostic = v.InferOutput<typeof DuplicateCommentDiagnostic>;

const ComponentCommentMismatchDiagnosticImpl = v.strictObject({
	kind: v.literal('component_comment_mismatch'),
	...baseDiagnosticFields
});
/** @nodocs */
export interface ComponentCommentMismatchDiagnosticSchema extends Named<
	typeof ComponentCommentMismatchDiagnosticImpl
> {}
/**
 * svelte2tsx, and so editor hover, documents a component with a different
 * HTML comment than the analyzer does.
 *
 * The analyzer reads the first HTML comment with a line starting
 * `@component`; svelte2tsx takes the last one containing `@component`
 * anywhere, so a second component comment or a mid-prose mention (a
 * backticked `@component` in a module comment) takes its slot. `line` is the
 * comment svelte2tsx picks; reword its `@component` to agree. Not emitted
 * when in-script JSDoc supplies the component's doc.
 */
export const ComponentCommentMismatchDiagnostic: ComponentCommentMismatchDiagnosticSchema =
	ComponentCommentMismatchDiagnosticImpl;
export type ComponentCommentMismatchDiagnostic = v.InferOutput<
	typeof ComponentCommentMismatchDiagnostic
>;

const MisplacedTagDiagnosticImpl = v.strictObject({
	kind: v.literal('misplaced_tag'),
	...baseDiagnosticFields,
	/**
	 * The tag name without the `@` prefix (e.g., `'example'`, `'deprecated'`).
	 * A synonym reports its canonical name: `@return` as `'returns'`,
	 * `@defaultValue` as `'default'`.
	 */
	tagName: v.picklist([
		'example',
		'deprecated',
		'internal',
		'since',
		'see',
		'throws',
		'mutates',
		'default',
		'nodocs',
		'param',
		'returns',
		'cssprop'
	]),
	/**
	 * Name of the enclosing symbol: the function or method whose overload
	 * carries the misplaced tag, or the declaration carrying a `@cssprop`.
	 * Absent for module-comment misplacements (no enclosing symbol).
	 */
	functionName: v.optional(v.string())
});
/** @nodocs */
export interface MisplacedTagDiagnosticSchema extends Named<typeof MisplacedTagDiagnosticImpl> {}
/**
 * A JSDoc tag found somewhere it has no effect.
 *
 * Two contexts emit this:
 *
 * - **Non-primary overload signature** — symbol-scope tags (`@example`,
 *   `@deprecated`, `@internal`, `@since`, `@see`, `@throws`, `@mutates`,
 *   `@default`, `@nodocs`) describe the function as a whole, not individual
 *   signatures.
 *   The primary signature's JSDoc feeds the parent declaration's symbol-level
 *   extraction; tags on non-primary overload signatures are silently dropped
 *   from output. This diagnostic surfaces them so authors can move them to
 *   the primary signature. `@default` and `@nodocs` are included even though
 *   overloads never carry a `defaultValue` or per-overload exclusion: their
 *   presence on a non-primary signature is always a misplacement.
 * - **Module comment** — tags that only describe a declaration (`@param`,
 *   `@returns`, `@mutates`, `@throws`, `@default`, `@nodocs`, `@cssprop`)
 *   have no module-level meaning, so a `@module` comment's are dropped, one
 *   warning per tag name per comment. `@nodocs` applies to declarations and
 *   export statements; to omit a module from analysis, use `exclude` patterns
 *   instead. `@param` and `@returns` occur only here.
 * - **Non-component declaration** — `@cssprop` (or `@cssproperty`, reported
 *   as `'cssprop'`) documents a Svelte component's CSS custom properties, so
 *   on any other exported declaration (a function, a `<script module>` export)
 *   it's dropped, one warning per declaration. Members, props, and
 *   parameters drop it silently.
 */
export const MisplacedTagDiagnostic: MisplacedTagDiagnosticSchema = MisplacedTagDiagnosticImpl;
export type MisplacedTagDiagnostic = v.InferOutput<typeof MisplacedTagDiagnostic>;

const ImplementationDocHiddenDiagnosticImpl = v.strictObject({
	kind: v.literal('implementation_doc_hidden'),
	...baseDiagnosticFields,
	/** Name of the overloaded function, method, or constructor. */
	functionName: v.string()
});
/** @nodocs */
export interface ImplementationDocHiddenDiagnosticSchema extends Named<
	typeof ImplementationDocHiddenDiagnosticImpl
> {}
/**
 * An overloaded function, method, or constructor documents its
 * implementation, whose JSDoc is hidden.
 *
 * Only overload signatures are public, so TypeScript's hover ignores the
 * implementation's JSDoc, and so does the output: its prose and tags drop,
 * an implementation `@nodocs` hides nothing, and the symbol's docs come from
 * its first overload. Fires for a TS implementation (the bodied declaration
 * after its overloads) and for a JS implementation's JSDoc blocks that host
 * no `@overload` tag, when they carry doc content; a block of types alone
 * (`@param {string} a`) doesn't fire. `line`/`column` point at the
 * implementation. Move the docs to the first overload.
 *
 * Always `warning`, query-time category (recomputed each `query()`).
 */
export const ImplementationDocHiddenDiagnostic: ImplementationDocHiddenDiagnosticSchema =
	ImplementationDocHiddenDiagnosticImpl;
export type ImplementationDocHiddenDiagnostic = v.InferOutput<
	typeof ImplementationDocHiddenDiagnostic
>;

const UnknownParamDiagnosticImpl = v.strictObject({
	kind: v.literal('unknown_param'),
	...baseDiagnosticFields,
	/** The `@param` key that didn't match a real parameter. */
	paramName: v.string(),
	/** Name of the function or method. */
	functionName: v.string()
});
/** @nodocs */
export interface UnknownParamDiagnosticSchema extends Named<typeof UnknownParamDiagnosticImpl> {}
/**
 * `@param` tag references a name that doesn't match any actual parameter.
 *
 * Usually a typo (`@param argz` for parameter `args`) or stale doc after a
 * rename. The description is dropped; analysis continues.
 */
export const UnknownParamDiagnostic: UnknownParamDiagnosticSchema = UnknownParamDiagnosticImpl;
export type UnknownParamDiagnostic = v.InferOutput<typeof UnknownParamDiagnostic>;

const UnknownCsspropDiagnosticImpl = v.strictObject({
	kind: v.literal('unknown_cssprop'),
	...baseDiagnosticFields,
	/** The custom property the `@cssprop` tag names, `--` included. */
	propertyName: v.string(),
	/** Name of the component. */
	componentName: v.string()
});
/** @nodocs */
export interface UnknownCsspropDiagnosticSchema extends Named<
	typeof UnknownCsspropDiagnosticImpl
> {}
/**
 * A component's `@cssprop` tag names a custom property the component never
 * reads through `var()`: not in its `<style>` (nested fallbacks included),
 * nor in the static text of its markup's `style` attributes, `style:`
 * directives, or child components' `style` and `--a` attributes.
 *
 * Usually a typo or a stale tag; it may also be a property the component
 * leaves for its children to read. The entry stays in
 * `ComponentDeclarationJson.cssCustomProperties`, `documented: true`, at the
 * tag's line, which `line` also points at. Not emitted when the style wasn't
 * read (`css_parse_failed`, `css_lang_unsupported`).
 *
 * Always `warning`, query-time category.
 */
export const UnknownCsspropDiagnostic: UnknownCsspropDiagnosticSchema =
	UnknownCsspropDiagnosticImpl;
export type UnknownCsspropDiagnostic = v.InferOutput<typeof UnknownCsspropDiagnostic>;

const MalformedTagDiagnosticImpl = v.strictObject({
	kind: v.literal('malformed_tag'),
	...baseDiagnosticFields,
	/** The tag name without the `@` prefix; a synonym reports its canonical name. */
	tagName: v.picklist(['cssprop']),
	/** Name of the declaration whose doc comment carries the tag. */
	declarationName: v.string()
});
/** @nodocs */
export interface MalformedTagDiagnosticSchema extends Named<typeof MalformedTagDiagnosticImpl> {}
/**
 * A JSDoc tag whose text doesn't parse as the tag's form, so it documents
 * nothing.
 *
 * Today only `@cssprop` (`@cssproperty`): its text names no custom property
 * (`@cssprop card_width - …`, a name without `--`; `@cssprop --a: …`; an
 * unclosed `{…}` or `[…]`; an empty tag). Emitted on a Svelte component's
 * doc comment, at the tag's line; on any other declaration the tag warns
 * `misplaced_tag` instead, whether or not it parses. The tag is dropped.
 *
 * Always `warning`, query-time category.
 */
export const MalformedTagDiagnostic: MalformedTagDiagnosticSchema = MalformedTagDiagnosticImpl;
export type MalformedTagDiagnostic = v.InferOutput<typeof MalformedTagDiagnostic>;

const DuplicateTagDiagnosticImpl = v.strictObject({
	kind: v.literal('duplicate_tag'),
	...baseDiagnosticFields,
	/** The tag name without the `@` prefix; a synonym reports its canonical name. */
	tagName: v.picklist(['cssprop']),
	/** Name of the declaration whose doc comment carries the tags. */
	declarationName: v.string(),
	/** The repeated key: the custom property's name for `@cssprop`, `--` included. */
	key: v.string()
});
/** @nodocs */
export interface DuplicateTagDiagnosticSchema extends Named<typeof DuplicateTagDiagnosticImpl> {}
/**
 * A JSDoc tag repeats a key an earlier tag of the same name in the comment
 * already set, so it documents nothing.
 *
 * Today only `@cssprop` (`@cssproperty`): a second tag naming the same
 * custom property. Emitted on a Svelte component's doc comment, at the
 * later tag's line; the first tag wins. On any other declaration the tags
 * warn `misplaced_tag` instead.
 *
 * Always `warning`, query-time category.
 */
export const DuplicateTagDiagnostic: DuplicateTagDiagnosticSchema = DuplicateTagDiagnosticImpl;
export type DuplicateTagDiagnostic = v.InferOutput<typeof DuplicateTagDiagnostic>;

const CsspropDefaultMismatchDiagnosticImpl = v.strictObject({
	kind: v.literal('cssprop_default_mismatch'),
	...baseDiagnosticFields,
	/** The custom property the `@cssprop` tag names, `--` included. */
	propertyName: v.string(),
	/** Name of the component. */
	componentName: v.string(),
	/** The tag's bracketed default, verbatim. */
	default: v.string(),
	/** The style's fallback for the property, verbatim (`ComponentCssPropertyJson.fallback`). */
	fallback: v.string()
});
/** @nodocs */
export interface CsspropDefaultMismatchDiagnosticSchema extends Named<
	typeof CsspropDefaultMismatchDiagnosticImpl
> {}
/**
 * A component's `@cssprop` tag documents a default (`[--a=1px]`) that
 * differs from the fallback its style gives the property
 * (`ComponentCssPropertyJson.fallback`: the first `var()` read's fallback,
 * or an `@property` rule's `initial-value`), compared as text with
 * whitespace runs collapsed.
 *
 * Usually a stale tag after the style changed, or a documented value
 * written in a form the style doesn't use (`red` against `#f00`): nothing
 * evaluates CSS, so an equivalent spelling warns too. The entry keeps both,
 * `default` and `fallback`, and `line` is the read's (the entry's
 * `sourceLine`). Not emitted when the style wasn't read.
 *
 * Always `warning`, query-time category.
 */
export const CsspropDefaultMismatchDiagnostic: CsspropDefaultMismatchDiagnosticSchema =
	CsspropDefaultMismatchDiagnosticImpl;
export type CsspropDefaultMismatchDiagnostic = v.InferOutput<
	typeof CsspropDefaultMismatchDiagnostic
>;

const DuplicateDeclarationDiagnosticImpl = v.strictObject({
	kind: v.literal('duplicate_declaration'),
	...baseDiagnosticFields,
	/** The duplicated declaration name. */
	declarationName: v.string(),
	/**
	 * Module paths where the name was defined (>= 2).
	 *
	 * `ModuleJson.path` values — relative to `sourceRoot`, so a different base
	 * than the record's `file` (project-root-relative, like every diagnostic).
	 * The two disagree textually whenever `sourceRoot` is non-empty; each names
	 * what it says it names, a module vs. a file.
	 */
	modules: v.pipe(v.array(v.string()), v.minLength(2))
});
/** @nodocs */
export interface DuplicateDeclarationDiagnosticSchema extends Named<
	typeof DuplicateDeclarationDiagnosticImpl
> {}
/**
 * A declaration `name` appears in more than one module.
 *
 * Opt-in: emitted only when `onDuplicates` is set, for packages that keep a
 * flat export namespace (see `OnDuplicates`). Emitted at `warning` severity
 * so the analysis result remains usable; `onDuplicates: 'throw'` makes it
 * fatal. The default slot (`name === 'default'`) is excluded — every module
 * owns its own.
 */
export const DuplicateDeclarationDiagnostic: DuplicateDeclarationDiagnosticSchema =
	DuplicateDeclarationDiagnosticImpl;
export type DuplicateDeclarationDiagnostic = v.InferOutput<typeof DuplicateDeclarationDiagnostic>;

const SourceMapFailedDiagnosticImpl = v.strictObject({
	kind: v.literal('source_map_failed'),
	...baseDiagnosticFields
});
/** @nodocs */
export interface SourceMapFailedDiagnosticSchema extends Named<
	typeof SourceMapFailedDiagnosticImpl
> {}
/**
 * Source map parsing failed for a Svelte virtual file.
 *
 * Analysis continues without position mapping: query-time diagnostics drop
 * `line`/`column` rather than point into svelte2tsx-generated TS — those
 * emitted against the virtual via `remapVirtualDiagnosticPositions`,
 * `svelte_prop_failed` at its own emission site — while declaration
 * `sourceLine`s fall back to virtual positions. Rare; usually signals a
 * malformed or incompatible svelte2tsx output.
 *
 * Emitted at ingest time by `transformSvelteSource` (in `svelte.ts`); flows
 * through `setFile`/`setFiles` ingest diagnostics rather than the analysis
 * pass.
 */
export const SourceMapFailedDiagnostic: SourceMapFailedDiagnosticSchema =
	SourceMapFailedDiagnosticImpl;
export type SourceMapFailedDiagnostic = v.InferOutput<typeof SourceMapFailedDiagnostic>;

const TransformFailedDiagnosticImpl = v.strictObject({
	kind: v.literal('transform_failed'),
	...baseDiagnosticFields
});
/** @nodocs */
export interface TransformFailedDiagnosticSchema extends Named<
	typeof TransformFailedDiagnosticImpl
> {}
/**
 * svelte2tsx transform threw for a `.svelte` file.
 *
 * Unrecoverable at ingest — the file's owned-entry stays in the session
 * (`virtual: undefined`, `unfilteredDeps: []`, `transformFailed: true`) so
 * `query()` can synthesize a placeholder `ModuleJson` (`partial: true`,
 * empty `declarations`). The originating error message lives in `message`;
 * this diagnostic is the authoritative cause-of-failure signal.
 */
export const TransformFailedDiagnostic: TransformFailedDiagnosticSchema =
	TransformFailedDiagnosticImpl;
export type TransformFailedDiagnostic = v.InferOutput<typeof TransformFailedDiagnostic>;

const ResolverFailedDiagnosticImpl = v.strictObject({
	kind: v.literal('resolver_failed'),
	...baseDiagnosticFields,
	/** The import specifier the resolver failed on. */
	specifier: v.string()
});
/** @nodocs */
export interface ResolverFailedDiagnosticSchema extends Named<
	typeof ResolverFailedDiagnosticImpl
> {}
/**
 * Import resolver threw while resolving a specifier.
 *
 * Distinguishes a buggy resolver from a legitimately unresolvable specifier:
 * resolvers that return `null` for unknown specifiers stay silent (the normal
 * "external package" case); resolvers that *throw* surface here so consumers
 * can fix the resolver. Recoverable — the session treats the throw as `null`
 * and continues, so analysis still runs but with a missing dependency edge.
 * Durable on the entry until a later `setFiles` that adds paths resolves the
 * specifier, which retires the diagnostic and adds the edge.
 *
 * Emitted at ingest time by the session's resolve phase.
 */
export const ResolverFailedDiagnostic: ResolverFailedDiagnosticSchema =
	ResolverFailedDiagnosticImpl;
export type ResolverFailedDiagnostic = v.InferOutput<typeof ResolverFailedDiagnostic>;

const AliasLostDiagnosticImpl = v.strictObject({
	kind: v.literal('alias_lost'),
	...baseDiagnosticFields,
	/** Name of the alias whose right-hand side resolves to a nameless type. */
	aliasName: v.string()
});
/** @nodocs */
export interface AliasLostDiagnosticSchema extends Named<typeof AliasLostDiagnosticImpl> {}
/**
 * An exported type alias loses its name at use sites.
 *
 * The alias's right-hand side (an indexed access or conditional —
 * `z.infer<typeof S>`, valibot's `InferOutput`) resolves to a pre-existing
 * interned type that TypeScript never retroactively stamps an alias symbol
 * on, so unannotated positions document the expansion instead of the name.
 * Fires only where nothing self-heals: a loss the alias registry recovers
 * (`typeInfo` emits `{kind: 'reference', name}` at use sites) is suppressed,
 * as are literal-only unions (`z.enum` outputs) and brand-like intersections
 * (`.brand()`) — readable degradations with no author-side fix worth
 * demanding. `@nodocs` on the declaration suppresses. The author-side escape
 * for a flagged alias is a nominal symbol, e.g.
 * `interface Foo extends z.infer<typeof S> {}` where applicable.
 *
 * Always `warning`, query-time category (recomputed each `query()`).
 */
export const AliasLostDiagnostic: AliasLostDiagnosticSchema = AliasLostDiagnosticImpl;
export type AliasLostDiagnostic = v.InferOutput<typeof AliasLostDiagnostic>;

const CommonjsUnsupportedDiagnosticImpl = v.strictObject({
	kind: v.literal('commonjs_unsupported'),
	...baseDiagnosticFields
});
/** @nodocs */
export interface CommonjsUnsupportedDiagnosticSchema extends Named<
	typeof CommonjsUnsupportedDiagnosticImpl
> {}
/**
 * A JS module exports through CommonJS (`module.exports = …`,
 * `exports.x = …`), which isn't modeled.
 *
 * The module still emits, with no declarations; `line`/`column` point at the
 * first export assignment. Fires only when the checker gives the file no
 * module symbol (no ES syntax under `bundler`/`esnext`) and a top-level
 * statement assigns to `module.exports` or `exports`. A file with ES syntax is
 * an ES module, its assignments ordinary code; under `node16`/`nodenext` or
 * `moduleDetection: 'force'` the checker binds the CommonJS exports itself,
 * and its named exports (`exports.x`, `module.exports = {a, b}`) document,
 * with no warning; a `module.exports =` of a non-object documents nothing. A script with no exports
 * either way (`require` calls alone), or one whose own top-level declaration
 * binds `exports` or `module`, doesn't fire.
 *
 * Always `warning`, query-time category (recomputed each `query()`).
 */
export const CommonjsUnsupportedDiagnostic: CommonjsUnsupportedDiagnosticSchema =
	CommonjsUnsupportedDiagnosticImpl;
export type CommonjsUnsupportedDiagnostic = v.InferOutput<typeof CommonjsUnsupportedDiagnostic>;

const CssParseFailedDiagnosticImpl = v.strictObject({
	kind: v.literal('css_parse_failed'),
	...baseDiagnosticFields
});
/** @nodocs */
export interface CssParseFailedDiagnosticSchema extends Named<
	typeof CssParseFailedDiagnosticImpl
> {}
/**
 * Svelte's parser rejected a component that has a `<style>`, so its styling
 * API (`ComponentDeclarationJson.cssCustomProperties`) isn't read.
 *
 * Usually malformed CSS; also any template error under a Svelte that predates
 * loose parsing (5.13). The component
 * still emits, without `cssCustomProperties`. `line`/`column` are the
 * parser's, in the original `.svelte` source.
 *
 * Always `warning`, query-time category (reported each `query()` from the reading cached at
 * transform).
 */
export const CssParseFailedDiagnostic: CssParseFailedDiagnosticSchema =
	CssParseFailedDiagnosticImpl;
export type CssParseFailedDiagnostic = v.InferOutput<typeof CssParseFailedDiagnostic>;

const CssLangUnsupportedDiagnosticImpl = v.strictObject({
	kind: v.literal('css_lang_unsupported'),
	...baseDiagnosticFields,
	/** The style tag's `lang` (or `type`) value, as written (`scss`, `text/postcss`). */
	lang: v.string()
});
/** @nodocs */
export interface CssLangUnsupportedDiagnosticSchema extends Named<
	typeof CssLangUnsupportedDiagnosticImpl
> {}
/**
 * A component's `<style>` names a preprocessor language (`lang="scss"`,
 * `type="text/postcss"`), which isn't read: its styling API
 * (`ComponentDeclarationJson.cssCustomProperties`) is left empty. Only
 * `lang="css"` and `type="text/css"` read as CSS. `line`/`column` point at
 * the style tag.
 *
 * Always `warning`, query-time category (reported each `query()` from the reading cached at
 * transform).
 */
export const CssLangUnsupportedDiagnostic: CssLangUnsupportedDiagnosticSchema =
	CssLangUnsupportedDiagnosticImpl;
export type CssLangUnsupportedDiagnostic = v.InferOutput<typeof CssLangUnsupportedDiagnostic>;

/**
 * Discriminated union of all diagnostic variants. Ingest-time kinds:
 * `transform_failed`, `source_map_failed`, `import_parse_failed`, and
 * `resolver_failed`; discovery-time: `module_unreadable`; every other kind is
 * query-time.
 */
// the explicit `VariantSchema` annotation keeps the emitted declaration
// referential (each variant by name, not re-inlined), and means a new variant
// must land in both the type-parameter tuple and the runtime array
export const Diagnostic: v.VariantSchema<
	'kind',
	[
		typeof TypeExtractionDiagnostic,
		typeof SignatureAnalysisDiagnostic,
		typeof ClassMemberDiagnostic,
		typeof SveltePropDiagnostic,
		typeof ModuleSkippedDiagnostic,
		typeof ModuleUnreadableDiagnostic,
		typeof ImportParseDiagnostic,
		typeof DuplicateCommentDiagnostic,
		typeof ComponentCommentMismatchDiagnostic,
		typeof MisplacedTagDiagnostic,
		typeof ImplementationDocHiddenDiagnostic,
		typeof UnknownParamDiagnostic,
		typeof UnknownCsspropDiagnostic,
		typeof MalformedTagDiagnostic,
		typeof DuplicateTagDiagnostic,
		typeof CsspropDefaultMismatchDiagnostic,
		typeof SourceMapFailedDiagnostic,
		typeof DuplicateDeclarationDiagnostic,
		typeof TransformFailedDiagnostic,
		typeof ResolverFailedDiagnostic,
		typeof AliasLostDiagnostic,
		typeof CommonjsUnsupportedDiagnostic,
		typeof CssParseFailedDiagnostic,
		typeof CssLangUnsupportedDiagnostic
	],
	undefined
> = v.variant('kind', [
	TypeExtractionDiagnostic,
	SignatureAnalysisDiagnostic,
	ClassMemberDiagnostic,
	SveltePropDiagnostic,
	ModuleSkippedDiagnostic,
	ModuleUnreadableDiagnostic,
	ImportParseDiagnostic,
	DuplicateCommentDiagnostic,
	ComponentCommentMismatchDiagnostic,
	MisplacedTagDiagnostic,
	ImplementationDocHiddenDiagnostic,
	UnknownParamDiagnostic,
	UnknownCsspropDiagnostic,
	MalformedTagDiagnostic,
	DuplicateTagDiagnostic,
	CsspropDefaultMismatchDiagnostic,
	SourceMapFailedDiagnostic,
	DuplicateDeclarationDiagnostic,
	TransformFailedDiagnostic,
	ResolverFailedDiagnostic,
	AliasLostDiagnostic,
	CommonjsUnsupportedDiagnostic,
	CssParseFailedDiagnostic,
	CssLangUnsupportedDiagnostic
]);
export type Diagnostic = v.InferOutput<typeof Diagnostic>;

const DiagnosticArray = v.array(Diagnostic);

/**
 * Validate an array of diagnostics.
 *
 * The stable way to validate diagnostics stored or sent on their own,
 * independent of the schema library behind `Diagnostic`. For a whole
 * analysis result use `parseAnalyzeResult`.
 *
 * @param value - an array of diagnostics, typically from `JSON.parse`
 * @returns the validated diagnostics
 * @throws Error when `value` doesn't match the schema; the message lists the
 *   reported issues, one per line, as `path: message` (`0.kind: Invalid type: …`), the dot
 *   path omitted for an issue at the root. The class is the schema library's
 *   (valibot's `ValiError`, the structured list on `issues`), so catch it as a
 *   plain `Error` unless you depend on valibot
 */
export const parseDiagnostics = (value: unknown): Array<Diagnostic> =>
	parseWithSummary(DiagnosticArray, value);

// Helpers

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
	kind: K
): Array<Extract<Diagnostic, { kind: K }>> =>
	diagnostics.filter((d) => d.kind === kind) as Array<Extract<Diagnostic, { kind: K }>>;

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
	const { file, line, column, severity, message } = diagnostic;
	const location =
		line !== undefined ? (column !== undefined ? `${line}:${column}` : `${line}`) : '';
	const filePart = location ? `./${file}:${location}` : `./${file}`;
	return `${filePart}: ${severity}: ${message}`;
};
