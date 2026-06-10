/**
 * svelte-docinfo: static analysis for TypeScript and Svelte.
 *
 * This barrel export provides the common API surface. Every module also exports
 * its full public API via direct imports (e.g., `svelte-docinfo/typescript-exports.js`)
 * for power users who need lower-level access to TypeScript compiler wrappers,
 * Svelte analysis internals, or TSDoc parsing utilities.
 *
 * @module
 * @nodocs
 */

// ── Core entry points ───────────────────────────────────────────────────────

export {analyze, analyzeFromFiles} from './analyze.js';
export type {AnalyzeOptions, AnalyzeFromFilesOptions} from './analyze.js';
export {throwOnDuplicates, AnalyzeResultJson} from './analyze-core.js';
export type {AnalyzeResultJsonWire, OnDuplicates, OnDuplicatesCallback} from './analyze-core.js';
export {createAnalysisSession} from './session.js';
export type {
	AnalysisSession,
	AnalysisSessionOptions,
	SetFileOptions,
	SetFileResult,
	SetFilesResult,
	QueryOptions,
} from './session.js';
export {normalizeResolveImport} from './dep-resolver.js';
export type {ImportResolver, ResolveImport, ResolveImportFn} from './dep-resolver.js';

// ── Types (Zod schemas + TypeScript interfaces) ─────────────────────────────

export {
	DeclarationKind,
	DeclarationModifier,
	MemberKind,
	Reactivity,
	GenericParamJson,
	ParameterJson,
	ComponentPropJson,
	OverloadJson,
	FunctionMemberJson,
	VariableMemberJson,
	ConstructorMemberJson,
	MemberJson,
	FunctionDeclarationJson,
	ClassDeclarationJson,
	InterfaceDeclarationJson,
	TypeDeclarationJson,
	VariableDeclarationJson,
	EnumDeclarationJson,
	ComponentDeclarationJson,
	SnippetDeclarationJson,
	NamespaceDeclarationJson,
	DeclarationJson,
	ReExportJson,
	ModuleJson,
} from './types.js';

// ── Declaration helpers ────────────────────────────────────────────────────

export {
	getDisplayName,
	generateImport,
	compactReplacer,
	isKind,
	findTypeReferences,
	buildTypeReferencePatterns,
} from './declaration-helpers.js';

// ── Source types ────────────────────────────────────────────────────────────

export type {SourceFileInfo, AnalyzerType} from './source.js';

// ── Source options ──────────────────────────────────────────────────────────

export {createSourceOptions, DEFAULT_SOURCE_OPTIONS} from './source-config.js';
export type {ModuleSourceOptions, SourceOptionsDefaults} from './source-config.js';

// ── Post-processing ────────────────────────────────────────────────────────

export {findDuplicates, mergeReExports, resolveComponentAliases} from './postprocess.js';
export type {DuplicateDeclaration} from './postprocess.js';

// ── File system constants ──────────────────────────────────────────────────

export {deriveIncludePatterns} from './files.js';

// ── File discovery ──────────────────────────────────────────────────────────

export {discoverSourceFiles} from './discovery.js';
export type {
	Discovery,
	DiscoverSourceFilesOptions,
	DiscoverSourceFilesResult,
} from './discovery.js';

// ── Diagnostics ─────────────────────────────────────────────────────────────

export {
	hasErrors,
	hasWarnings,
	errorsOf,
	warningsOf,
	byKind,
	formatDiagnostic,
	DiagnosticSeverity,
	DiagnosticKind,
	Diagnostic,
} from './diagnostics.js';
export type {AnalysisLog} from './log.js';
