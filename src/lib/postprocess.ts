/**
 * Post-processing for analyzed library metadata.
 *
 * These functions transform analysis results after module-level analysis is complete:
 *
 * 1. **Validation** — `findDuplicates` checks flat namespace constraints
 * 2. **Transformation** — `mergeReExports` resolves re-export relationships,
 *    `computeDependents` builds bidirectional dependency graphs
 * 3. **Output** — `sortModules` prepares deterministic output
 *
 * @see `analyze.ts` for the main analysis entry point
 *
 * @module
 */

import type {ComponentDeclarationJson, DeclarationJson, ModuleJson} from './types.js';
import type {SourceFileInfo} from './source.js';
import {toPosixPath} from './paths.js';

/**
 * Posixify every entry in `arr`. Returns the same array reference when no
 * entry needed normalization, so identity-equality short-circuits in
 * `computeDependents`'s no-rewrite branch.
 */
const posixifyArray = (
	arr: ReadonlyArray<string> | undefined,
): ReadonlyArray<string> | undefined => {
	if (!arr) return arr;
	let changed: Array<string> | null = null;
	for (let i = 0; i < arr.length; i++) {
		const p = toPosixPath(arr[i]!);
		if (p !== arr[i]) {
			if (!changed) changed = arr.slice();
			changed[i] = p;
		}
	}
	return changed ?? arr;
};

/**
 * A duplicate declaration with its full metadata and module path.
 */
export interface DuplicateDeclaration {
	/** The full declaration metadata. */
	declaration: DeclarationJson;
	/** Module path where this declaration is defined. */
	module: string;
}

/**
 * Find duplicate declaration names across modules.
 *
 * Callers can decide how to handle duplicates (throw, warn, ignore).
 *
 * @returns `Map` of declaration names to their `DuplicateDeclaration` occurrences (only includes duplicates)
 *
 * @example
 * ```ts
 * const duplicates = findDuplicates(modules);
 * if (duplicates.size > 0) {
 *   for (const [name, occurrences] of duplicates) {
 *     console.error(`"${name}" found in:`);
 *     for (const {declaration, module} of occurrences) {
 *       console.error(`  - ${module}:${declaration.sourceLine} (${declaration.kind})`);
 *     }
 *   }
 *   throw new Error(`Found ${duplicates.size} duplicate declaration names`);
 * }
 * ```
 */
export const findDuplicates = (
	modules: Array<ModuleJson>,
): Map<string, Array<DuplicateDeclaration>> => {
	const allOccurrences: Map<string, Array<DuplicateDeclaration>> = new Map();

	// Collect declaration names. The default slot is module-scoped per the JS
	// spec — every module can have its own `'default'` and they don't collide
	// — so skip `name === 'default'` entries from this flat-namespace check.
	for (const mod of modules) {
		for (const declaration of mod.declarations) {
			if (declaration.name === 'default') continue;
			if (!allOccurrences.has(declaration.name)) {
				allOccurrences.set(declaration.name, []);
			}
			allOccurrences.get(declaration.name)!.push({
				declaration,
				module: mod.path,
			});
		}
	}

	// Filter to only duplicates
	const duplicates: Map<string, Array<DuplicateDeclaration>> = new Map();
	for (const [name, occurrences] of allOccurrences) {
		if (occurrences.length > 1) {
			duplicates.set(name, occurrences);
		}
	}

	return duplicates;
};

/**
 * Code-unit string comparator for deterministic output ordering.
 *
 * Unlike `localeCompare` (host-locale/ICU-dependent, so byte-identical input
 * can serialize in different orders on different machines), code-unit order is
 * environment-independent — and it matches the default `Array.prototype.sort`
 * used for `alsoExportedFrom`, `dependencies`, and `dependents`.
 */
export const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Sort modules alphabetically by path for deterministic output and cleaner diffs.
 *
 * Code-unit order (`compareStrings`) so the output is environment-independent.
 *
 * @param modules - the modules to sort
 * @returns a new sorted array (does not mutate input)
 */
export const sortModules = (modules: Array<ModuleJson>): Array<ModuleJson> => {
	return modules.slice().sort((a, b) => compareStrings(a.path, b.path));
};

/**
 * Build `alsoExportedFrom` arrays from the modules' forward re-export edges.
 *
 * Each module carries its same-name re-export edges as `ModuleJson.reExports`
 * (collected in phase 1); this phase-2 pass inverts them onto the canonical
 * declarations so both directions of the same fact are queryable. Edges whose
 * canonical module or declaration is absent from `modules` are skipped — the
 * forward entry remains without a back-link (see `ReExportJson` for the
 * presence caveats).
 *
 * Component-only fields on renamed component aliases (`props`,
 * `acceptsChildren`, etc.) are populated separately by `resolveComponentAliases`
 * — call it after this function. They split because they touch disjoint fields
 * and have different inputs.
 *
 * @param modules - the modules array with all modules (will be mutated).
 *   Must be parsed `ModuleJson`s — wire JSON strips empty arrays, so run
 *   raw JSON through `AnalyzeResultJson.parse` first or `reExports` may be
 *   `undefined`
 * @mutates modules - unions re-exporters into `declaration.alsoExportedFrom`
 *   (deduped + sorted), so a second call with the same inputs is a no-op
 *
 * @example
 * ```ts
 * // helpers.ts exports: foo, bar
 * // index.ts does: export {foo, bar} from './helpers.js'
 * // (so index.ts's ModuleJson carries reExports:
 * //   [{name: 'foo', module: 'helpers.ts'}, {name: 'bar', module: 'helpers.ts'}])
 * //
 * // After processing:
 * // - helpers.ts foo declaration gets: alsoExportedFrom: ['index.ts']
 * // - helpers.ts bar declaration gets: alsoExportedFrom: ['index.ts']
 * ```
 */
export const mergeReExports = (modules: Array<ModuleJson>): void => {
	// Group edges by `(canonical module, name)`. The default slot keys as
	// `'default'` like any other name — each module owns its own default slot,
	// so the per-module map prevents cross-module collisions naturally.
	const reExportMap: Map<string, Map<string, Array<string>>> = new Map();

	for (const mod of modules) {
		for (const {name, module: originalModule} of mod.reExports) {
			if (!reExportMap.has(originalModule)) {
				reExportMap.set(originalModule, new Map());
			}
			const moduleMap = reExportMap.get(originalModule)!;
			if (!moduleMap.has(name)) {
				moduleMap.set(name, []);
			}
			moduleMap.get(name)!.push(mod.path);
		}
	}

	// Merge into original declarations
	for (const mod of modules) {
		const moduleReExports = reExportMap.get(mod.path);
		if (!moduleReExports) continue;

		for (const declaration of mod.declarations) {
			const reExporters = moduleReExports.get(declaration.name);
			if (reExporters?.length) {
				// Union with existing entries, dedupe, sort — keeps the function idempotent
				// when re-run on already-merged modules
				const merged = new Set(declaration.alsoExportedFrom);
				for (const reExporter of reExporters) merged.add(reExporter);
				declaration.alsoExportedFrom = Array.from(merged).sort();
			}
		}
	}
};

/**
 * Copy props/acceptsChildren/lang/etc. from canonical component declarations
 * onto synthesized component-aliased declarations.
 *
 * Renamed Svelte component re-exports (`export {default as Foo} from './X.svelte'`)
 * are emitted as `kind: 'component'` placeholders by `analyzeExports`, with `aliasOf`
 * pointing at the canonical. The canonical's component-specific fields are only
 * available after `analyzeSvelteModule` synthesizes the canonical declaration, so
 * the copy happens here in phase 2 once all modules are analyzed.
 *
 * Call this *after* `mergeReExports` — both walk the same modules array but
 * read/write disjoint fields, so order between them only matters for clarity.
 *
 * @mutates modules - fills component-only fields on aliased component declarations
 */
export const resolveComponentAliases = (modules: Array<ModuleJson>): void => {
	// Build {modulePath → {componentName → ComponentDeclarationJson}} for canonical lookups
	const canonicalByModule = new Map<string, Map<string, ComponentDeclarationJson>>();
	for (const mod of modules) {
		for (const decl of mod.declarations) {
			if (decl.kind !== 'component' || decl.aliasOf) continue;
			let perModule = canonicalByModule.get(mod.path);
			if (!perModule) {
				perModule = new Map();
				canonicalByModule.set(mod.path, perModule);
			}
			perModule.set(decl.name, decl);
		}
	}

	for (const mod of modules) {
		for (const decl of mod.declarations) {
			if (decl.kind !== 'component' || !decl.aliasOf) continue;
			const canonical = canonicalByModule.get(decl.aliasOf.module)?.get(decl.aliasOf.name);
			if (!canonical) continue;
			decl.props = canonical.props;
			decl.acceptsChildren = canonical.acceptsChildren;
			decl.intersects = canonical.intersects;
			decl.genericParams = canonical.genericParams;
			if (canonical.lang !== undefined) decl.lang = canonical.lang;
			if (canonical.docComment !== undefined && decl.docComment === undefined) {
				decl.docComment = canonical.docComment;
			}
			if (canonical.typeSignature !== undefined && decl.typeSignature === undefined) {
				decl.typeSignature = canonical.typeSignature;
			}
			if (canonical.examples.length > 0 && decl.examples.length === 0) {
				decl.examples = canonical.examples;
			}
			if (canonical.seeAlso.length > 0 && decl.seeAlso.length === 0) {
				decl.seeAlso = canonical.seeAlso;
			}
			if (canonical.throws.length > 0 && decl.throws.length === 0) {
				decl.throws = canonical.throws;
			}
			if (canonical.deprecatedMessage !== undefined && decl.deprecatedMessage === undefined) {
				decl.deprecatedMessage = canonical.deprecatedMessage;
			}
			if (canonical.since !== undefined && decl.since === undefined) {
				decl.since = canonical.since;
			}
			if (canonical.mutates !== undefined && decl.mutates === undefined) {
				decl.mutates = canonical.mutates;
			}
			if (canonical.partial) decl.partial = true;
		}
	}
};

/**
 * Compute bidirectional dependencies from source files.
 *
 * This function ensures that if file A has file B in its `dependencies`,
 * then file B will have file A in its `dependents`. This provides consistent
 * output regardless of whether callers provide one-directional or bidirectional
 * dependency information.
 *
 * Returns new `SourceFileInfo` objects when computed dependents exist or when
 * paths needed posixification; otherwise the original input objects flow
 * through `===`-equal (fast path for session callers, who already pass POSIX
 * paths and may have no inferable dependents for a given file).
 *
 * @param files - source files with optional dependency information
 * @returns new array with bidirectional dependencies computed
 *
 * @example
 * ```ts
 * // Input: Calculator.svelte has dependencies: [math.ts]
 * // Output: Calculator.svelte has dependencies: [math.ts]
 * //         math.ts has dependents: [Calculator.svelte]
 * const filesWithBidirectional = computeDependents(files);
 * ```
 */
export const computeDependents = (
	files: ReadonlyArray<SourceFileInfo>,
): Array<SourceFileInfo & {dependents?: ReadonlyArray<string>}> => {
	// Posixify ids and dependency lists at the boundary so a power user
	// supplying a hand-built `SourceFileInfo[]` with mixed-shape paths still
	// gets correct lookup behavior. Identity-preserving when no normalization
	// is needed (session callers, who already pass POSIX): both arrays and the
	// outer `SourceFileInfo` flow through `===`-equal.
	const posixFiles = files.map((file) => {
		const posixId = toPosixPath(file.id);
		const posixDeps = posixifyArray(file.dependencies);
		if (posixId === file.id && posixDeps === file.dependencies) {
			return file;
		}
		return {
			...file,
			id: posixId,
			dependencies: posixDeps,
		};
	});

	// Build a map of file id -> dependents (computed from dependencies)
	const computedDependents: Map<string, Set<string>> = new Map();

	// Initialize all files in the map
	for (const file of posixFiles) {
		computedDependents.set(file.id, new Set());
	}

	// Compute dependents from dependencies
	for (const file of posixFiles) {
		if (!file.dependencies) continue;
		for (const depId of file.dependencies) {
			// Only add if the dependency is in our file set
			if (computedDependents.has(depId)) {
				computedDependents.get(depId)!.add(file.id);
			}
		}
	}

	// Attach computed dependents to each file. Dependents are derived from
	// forward edges in the owned set, not from caller input — the public
	// `SourceFileInfo` carries no `dependents` field.
	return posixFiles.map((file) => {
		const computed = computedDependents.get(file.id);
		if (!computed || computed.size === 0) {
			// No computed dependents, return as-is
			return file;
		}

		// Sort for deterministic output
		const dependents = Array.from(computed).sort();

		return {
			...file,
			dependents,
		};
	});
};
