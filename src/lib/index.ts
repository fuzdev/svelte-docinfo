/**
 * svelte-docinfo: static analysis for TypeScript and Svelte.
 *
 * This barrel export provides the common API surface. Every module also exports
 * its full public API via direct imports (e.g., `svelte-docinfo/typescript-exports.js`)
 * for power users who need lower-level access to TypeScript compiler wrappers,
 * Svelte analysis internals, or TSDoc parsing utilities.
 *
 * @module
 */

// Core entry points

export {analyze, analyzeFromFiles} from './analyze.ts';
export type {AnalyzeOptions, AnalyzeFromFilesOptions} from './analyze.ts';
export {throwOnDuplicates, AnalyzeResultJson} from './analyze-core.ts';
export type {AnalyzeResultJsonWire, OnDuplicates, OnDuplicatesCallback} from './analyze-core.ts';
export {createAnalysisSession} from './session.ts';
export type {
	AnalysisSession,
	AnalysisSessionOptions,
	SetFileOptions,
	SetFileResult,
	SetFilesResult,
	QueryOptions,
} from './session.ts';
export {normalizeResolveImport} from './dep-resolver.ts';
export type {ImportResolver, ResolveImport, ResolveImportFn} from './dep-resolver.ts';

// Types (Zod schemas + TypeScript interfaces)

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
	ExternalReExportJson,
	ModuleJson,
} from './types.ts';

// Declaration helpers

export {
	getDisplayName,
	generateImport,
	compactReplacer,
	isKind,
	findTypeReferences,
	buildTypeReferencePatterns,
} from './declaration-helpers.ts';

// Source types

export type {SourceFileInfo, AnalyzerType} from './source.ts';

// Source options

export {createSourceOptions, DEFAULT_SOURCE_OPTIONS} from './source-config.ts';
export type {ModuleSourceOptions, SourceOptionsDefaults} from './source-config.ts';

// Post-processing

export {
	findDuplicates,
	mergeReExports,
	resolveComponentAliases,
	resolveExportSurface,
} from './postprocess.ts';
export type {DuplicateDeclaration, ExportSurface, ExportSurfaceEntry} from './postprocess.ts';

// File system constants

export {deriveIncludePatterns} from './files.ts';

// File discovery

export {discoverSourceFiles} from './discovery.ts';
export type {
	Discovery,
	DiscoverSourceFilesOptions,
	DiscoverSourceFilesResult,
} from './discovery.ts';

// Diagnostics

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
} from './diagnostics.ts';
export type {AnalysisLog} from './log.ts';
