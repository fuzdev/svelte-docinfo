/**
 * Types for incremental declaration construction during analysis.
 *
 * These types are used by the analysis layer (`typescript-extract-*.ts`,
 * `typescript-exports.ts`, `svelte.ts`, `tsdoc.ts`) to build declarations before
 * Zod validation. Most consumers work with the validated types from `types.ts`,
 * but these are available for advanced use cases.
 *
 * @see `types.ts` for consumer-facing Zod schemas (`DeclarationJson`, `ModuleJson`)
 * @see `typescript-exports.ts` and `typescript-extract-*.ts` for TypeScript declaration analysis
 * @see `svelte.ts` for Svelte component analysis
 *
 * @module
 */

import {z} from 'zod';

import type {
	DeclarationKind,
	DeclarationModifier,
	GenericParamJson,
	MemberKind,
	ParameterJson,
	OverloadJsonInput,
	ComponentPropJsonInput,
	Reactivity,
	ReExportJsonInput,
	ExternalReExportJsonInput,
} from './types.ts';

/**
 * Permissive type for constructing members incrementally before Zod validation.
 *
 * Used by internal analysis functions in `typescript-extract-*.ts` that build members
 * by mutating a plain object. The discriminated union schema (`MemberJson`)
 * validates the final shape at the `ModuleJson.parse()` boundary.
 *
 * Mirrors `DeclarationJsonBuild` for the same reason: construction sites
 * determine `kind` at runtime, so TypeScript can't narrow the union during
 * incremental field assignment.
 */
export interface MemberJsonBuild {
	name?: string;
	kind: MemberKind;
	docComment?: string;
	typeSignature?: string;
	modifiers?: Array<DeclarationModifier>;
	sourceLine?: number;
	genericParams?: Array<GenericParamJson>;
	parameters?: Array<z.input<typeof ParameterJson>>;
	returnType?: string;
	returnDescription?: string;
	overloads?: Array<OverloadJsonInput>;
	examples?: Array<string>;
	deprecatedMessage?: string;
	seeAlso?: Array<string>;
	throws?: Array<{type?: string; description: string}>;
	since?: string;
	mutates?: Record<string, string>;
	reactivity?: Reactivity;
	partial?: boolean;
	/** Whether the member has a `?` token in its declaration. Function and variable members only. */
	optional?: boolean;
	/** Default value documented via `@default`. Variable members only. */
	defaultValue?: string;
}

/**
 * Permissive type for constructing declarations incrementally before Zod validation.
 *
 * Used by internal analysis functions (`analyzeDeclaration`, `extractFunctionInfo`, etc.)
 * that build declarations by mutating a plain object. The discriminated union schema
 * validates the final shape at the `ModuleJson.parse()` boundary.
 */
export interface DeclarationJsonBuild {
	name?: string;
	kind: DeclarationKind;
	docComment?: string;
	typeSignature?: string;
	modifiers?: Array<DeclarationModifier>;
	sourceLine?: number;
	parameters?: Array<z.input<typeof ParameterJson>>;
	returnType?: string;
	returnDescription?: string;
	genericParams?: Array<GenericParamJson>;
	overloads?: Array<OverloadJsonInput>;
	examples?: Array<string>;
	deprecatedMessage?: string;
	seeAlso?: Array<string>;
	throws?: Array<{type?: string; description: string}>;
	since?: string;
	mutates?: Record<string, string>;
	extends?: string | Array<string>;
	intersects?: Array<string>;
	implements?: Array<string>;
	members?: Array<MemberJsonBuild>;
	props?: Array<ComponentPropJsonInput>;
	acceptsChildren?: boolean;
	lang?: 'js';
	alsoExportedFrom?: Array<string>;
	aliasOf?: {module: string; name: string};
	reactivity?: Reactivity;
	partial?: boolean;
	/** Source module path for `kind: 'namespace'` declarations (`export * as ns from './x'`). */
	module?: string;
	/** Default value documented via `@default`. Variable declarations only. */
	defaultValue?: string;
}

/**
 * Result of analyzing a single declaration.
 *
 * Produced by `analyzeDeclaration` (in `typescript-exports.ts`) and Svelte component analysis.
 * Used by `analyzeModule` to filter `@nodocs` declarations before output.
 *
 * Uses `DeclarationJsonBuild` (not `DeclarationJsonInput`) because declarations
 * are constructed incrementally — Zod validation happens at the `ModuleJson.parse()` boundary.
 */
export interface DeclarationAnalysis {
	/** The analyzed declaration metadata (pre-validation). */
	declaration: DeclarationJsonBuild;
	/** Whether the declaration is marked `@nodocs` (should be excluded from documentation). */
	nodocs: boolean;
}

/**
 * Result of analyzing a module's exports.
 *
 * Produced by `analyzeExports` in `typescript-exports.ts`.
 */
export interface ModuleExportsAnalysis {
	/**
	 * Module-level documentation comment. Always `undefined` for svelte2tsx
	 * virtual files — `analyzeSvelteModule` extracts Svelte module comments
	 * from the original source instead.
	 */
	moduleComment?: string;
	/** All exported declarations with `@nodocs` flags — consumer filters based on policy. */
	declarations: Array<DeclarationAnalysis>;
	/**
	 * Same-name re-exports. Published as `ModuleJson.reExports` and consumed
	 * by `mergeReExports` in phase 2 to build `alsoExportedFrom` arrays on
	 * canonical declarations. Unsorted here and may contain exact duplicates
	 * (Svelte default-slot re-keying) — ordering and dedup are applied at
	 * publication in `analyze-core.ts`.
	 */
	reExports: Array<ReExportJsonInput>;
	/** Star exports (`export * from './module'`) — module paths that are fully re-exported. */
	starExports: Array<string>;
	/**
	 * Direct re-exports from external packages. Published as
	 * `ModuleJson.externalReExports`; unsorted here, sorted at publication.
	 */
	externalReExports: Array<ExternalReExportJsonInput>;
	/** External star exports (`export * from 'pkg'`) — specifiers as written. */
	externalStarExports: Array<string>;
}

/**
 * Result of analyzing a module (TypeScript or Svelte).
 *
 * Produced by `analyzeTypescriptModule` and `analyzeSvelteModule`.
 * Both analyzers return this same structure for uniform handling
 * by `analyzeModule` in `analyze-core.ts`.
 */
export interface ModuleAnalysis extends ModuleExportsAnalysis {
	/** Module path relative to source root. */
	path: string;
	/** Dependencies (other source modules this module imports). Empty if none. */
	dependencies: Array<string>;
	/** Dependents (other source modules that import this module). Empty if none. */
	dependents: Array<string>;
}
