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

import type {ComponentDeclarationJson, DeclarationJson, ModuleJson} from './types.ts';
import type {SourceFileInfo} from './source.ts';
import {toPosixPath} from './paths.ts';

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
 * Build the `(module, name)` → declaration lookup used for `aliasOf`-chain
 * walking. Key format: `` `${modulePath}\n${name}` `` — `\n` can't appear in
 * either part.
 */
const buildDeclarationIndex = (modules: Array<ModuleJson>): Map<string, DeclarationJson> => {
	const byIdentity: Map<string, DeclarationJson> = new Map();
	for (const mod of modules) {
		for (const declaration of mod.declarations) {
			byIdentity.set(`${mod.path}\n${declaration.name}`, declaration);
		}
	}
	return byIdentity;
};

/**
 * Resolve a declaration to its canonical identity. A same-name re-export of
 * an intermediate rename produces an alias pointing at another alias, so a
 * single hop isn't enough — follow the chain through declarations present in
 * the index. The terminal is the declaration *object* when it's in the set
 * (object identity keeps two same-`(module, name)` declarations distinct in
 * pathological inputs), else the dangling `(module, name)` key (two aliases
 * of the same absent canonical still resolve to one identity). The visited
 * set guards malformed cyclic input.
 */
const resolveCanonicalIdentity = (
	byIdentity: Map<string, DeclarationJson>,
	modulePath: string,
	declaration: DeclarationJson,
): DeclarationJson | string => {
	let current = declaration;
	const visited = new Set([`${modulePath}\n${declaration.name}`]);
	while (current.aliasOf) {
		const nextKey = `${current.aliasOf.module}\n${current.aliasOf.name}`;
		if (visited.has(nextKey)) return nextKey;
		visited.add(nextKey);
		const next = byIdentity.get(nextKey);
		if (!next) return nextKey;
		current = next;
	}
	return current;
};

/**
 * Find duplicate declaration names across modules.
 *
 * A duplicate is two *different things* sharing a name in the flat namespace.
 * Occurrences are compared by canonical identity — `aliasOf` chains are
 * resolved first, so an alias and its canonical (or two aliases of the same
 * canonical) are one thing, not a collision. Documenting a same-name re-export
 * (which synthesizes an alias) or re-exporting a component under its own name
 * (`export {default as Foo} from './Foo.svelte'`) therefore doesn't flag.
 * When a name does flag, all occurrences are reported, aliases included.
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
	const byIdentity = buildDeclarationIndex(modules);
	const resolveCanonical = (modulePath: string, declaration: DeclarationJson) =>
		resolveCanonicalIdentity(byIdentity, modulePath, declaration);

	// Collect declaration names with their canonical identities. The default
	// slot is module-scoped per the JS spec — every module can have its own
	// `'default'` and they don't collide — so skip `name === 'default'`
	// entries from this flat-namespace check.
	const allOccurrences: Map<
		string,
		Array<DuplicateDeclaration & {canonical: DeclarationJson | string}>
	> = new Map();
	for (const mod of modules) {
		for (const declaration of mod.declarations) {
			if (declaration.name === 'default') continue;
			if (!allOccurrences.has(declaration.name)) {
				allOccurrences.set(declaration.name, []);
			}
			allOccurrences.get(declaration.name)!.push({
				declaration,
				module: mod.path,
				canonical: resolveCanonical(mod.path, declaration),
			});
		}
	}

	// A name is duplicated only when its occurrences span >1 canonical identity
	const duplicates: Map<string, Array<DuplicateDeclaration>> = new Map();
	for (const [name, occurrences] of allOccurrences) {
		const identities = new Set(occurrences.map((o) => o.canonical));
		if (identities.size > 1) {
			duplicates.set(
				name,
				occurrences.map(({declaration, module}) => ({declaration, module})),
			);
		}
	}

	return duplicates;
};

/**
 * Case-insensitive string comparator for deterministic output ordering.
 *
 * Case-folded comparison first (so `Analyze` and `analyze` sort together
 * instead of all uppercase before all lowercase), then a code-unit tiebreak —
 * so equal-ignoring-case strings still compare unequal and the result is an
 * exact total order. Unlike `localeCompare` (host-locale/ICU-dependent, so
 * byte-identical input can serialize in different orders on different
 * machines), both passes use Unicode default mappings only and are
 * environment-independent. All output ordering goes through this comparator —
 * never bare `localeCompare` or default `Array.prototype.sort`.
 */
export const compareStrings = (a: string, b: string): number => {
	const af = a.toLowerCase();
	const bf = b.toLowerCase();
	if (af < bf) return -1;
	if (af > bf) return 1;
	return a < b ? -1 : a > b ? 1 : 0;
};

/**
 * Sort modules alphabetically by path for deterministic output and cleaner diffs.
 *
 * Case-insensitive order (`compareStrings`) so the output is environment-independent.
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
				declaration.alsoExportedFrom = Array.from(merged).sort(compareStrings);
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
		const dependents = Array.from(computed).sort(compareStrings);

		return {
			...file,
			dependents,
		};
	});
};

/**
 * One name on a module's resolved export surface.
 */
export interface ExportSurfaceEntry {
	/**
	 * Exported name, in the docinfo model's terms — Svelte components appear
	 * under their filename-derived name (the model's convention for default
	 * exports of `.svelte` files), not `'default'`.
	 */
	name: string;
	/**
	 * How the name reaches this module's surface: an own declaration
	 * (including synthesized aliases), a same-name re-export edge, a direct
	 * external re-export, or projection through `export * from './x'`.
	 */
	via: 'declaration' | 'reExport' | 'external' | 'star';
	/** Canonical module path, when known (`undefined` for external entries). */
	module?: string;
	/** The canonical declaration, when present in the analyzed set. */
	declaration?: DeclarationJson;
	/** Package specifier for external entries (as written in the statement). */
	specifier?: string;
	/** Name inside the external package when renamed. */
	originalName?: string;
	/** Type-only re-export — the name is erased at runtime. */
	typeOnly?: boolean;
	/** For star-projected entries: the `starExports` target the name arrived through. */
	starFrom?: string;
}

/**
 * A module's resolved export surface — see `resolveExportSurface`.
 */
export interface ExportSurface {
	/** Surface entries, sorted by `name` (case-insensitive order, `compareStrings`). */
	entries: Array<ExportSurfaceEntry>;
	/**
	 * Star targets (own or transitive) absent from the analyzed set — their
	 * projected names are unknown, so the surface is incomplete.
	 */
	unresolvedStarExports: Array<string>;
	/**
	 * External star specifiers reachable from this module (own or transitive)
	 * — their projected names are unknowable without analyzing the package.
	 */
	externalStarExports: Array<string>;
}

interface InternalSurfaceEntry {
	entry: ExportSurfaceEntry;
	/** Canonical identity for ES ambiguity comparison across stars. */
	identity: DeclarationJson | string;
}

interface InternalSurface {
	entries: Map<string, InternalSurfaceEntry>;
	unresolvedStars: Set<string>;
	externalStars: Set<string>;
}

/**
 * Resolve a module's full export surface from the analyzed model, applying
 * ES module semantics to star exports.
 *
 * Combines the module's own `declarations` (including synthesized aliases),
 * `reExports` edges, `externalReExports`, and transitively-resolved
 * `starExports` into one deduped, name-sorted list. The ES rules applied to
 * star projection:
 *
 * - explicit exports (declarations, edges, externals) shadow star-projected
 *   names
 * - a name projected by two stars that resolve to *different* canonicals is
 *   ambiguous and excluded (same canonical through a diamond is included
 *   once)
 * - `default` is never star-projected — including canonical Svelte component
 *   declarations, which represent their file's default export. (Caveat: a
 *   star-projected re-export edge whose canonical is a component is treated
 *   as a default-slot re-export and skipped; a `<script module>` const
 *   sharing the component's exact name would be skipped with it.)
 *
 * A Position-3 alias and its `reExports` edge are the same fact — the
 * declaration entry wins, inheriting the edge's `typeOnly`.
 *
 * Cyclic star graphs terminate by contributing nothing along the back-edge
 * (an approximation of ES fixpoint resolution — fine in practice). Surfaces
 * resolved inside a cycle are path-relative and not memoized, so sibling
 * star paths resolve independently rather than inheriting them. Star
 * targets missing from `modules` are reported in `unresolvedStarExports`
 * rather than guessed at; `externalStarExports` aggregates external star
 * specifiers reachable from the module, whose names are unknowable.
 *
 * @param modules - the analyzed modules (parsed `ModuleJson`s — run wire
 *   JSON through `AnalyzeResultJson.parse` first)
 * @param path - the module to resolve, as a `ModuleJson.path` value
 * @returns the resolved surface, or `null` when `path` isn't in `modules`
 */
export const resolveExportSurface = (
	modules: Array<ModuleJson>,
	path: string,
): ExportSurface | null => {
	const byPath = new Map(modules.map((m) => [m.path, m]));
	if (!byPath.has(path)) return null;

	const byIdentity = buildDeclarationIndex(modules);
	const cache = new Map<string, InternalSurface>();
	const visiting = new Set<string>();
	const emptySurface = (): InternalSurface => ({
		entries: new Map(),
		unresolvedStars: new Set(),
		externalStars: new Set(),
	});

	// Only surfaces resolved without hitting a cycle back-edge are memoized.
	// A surface computed while one of its star ancestors is mid-resolution is
	// relative to that path — it can carry names a full resolution would
	// exclude as ambiguous (the back-edge contributed nothing to weigh them
	// against). Caching it would leak the path-relative answer to sibling
	// star paths; tainted surfaces are instead recomputed per consumer.
	// Recomputation is bounded by `visiting` and only occurs inside cyclic
	// clusters, which are pathological to begin with.
	const resolveModule = (modulePath: string): {surface: InternalSurface; tainted: boolean} => {
		const cached = cache.get(modulePath);
		if (cached) return {surface: cached, tainted: false};
		// Cycle break: a star back-edge contributes nothing
		if (visiting.has(modulePath)) return {surface: emptySurface(), tainted: true};
		visiting.add(modulePath);

		const mod = byPath.get(modulePath)!;
		const surface = emptySurface();
		let tainted = false;
		const {entries} = surface;

		// 1. Own declarations — including synthesized aliases and `default`
		const edgesByName = new Map(mod.reExports.map((e) => [e.name, e]));
		for (const declaration of mod.declarations) {
			// A Position-3 alias duplicates its edge; carry the edge's typeOnly
			const matchingEdge =
				declaration.aliasOf &&
				edgesByName.get(declaration.name)?.module === declaration.aliasOf.module
					? edgesByName.get(declaration.name)
					: undefined;
			entries.set(declaration.name, {
				entry: {
					name: declaration.name,
					via: 'declaration',
					module: modulePath,
					declaration,
					...(matchingEdge?.typeOnly ? {typeOnly: true} : {}),
				},
				identity: resolveCanonicalIdentity(byIdentity, modulePath, declaration),
			});
		}

		// 2. Same-name re-export edges not already covered by a declaration.
		// Edges can collide on `name` (Svelte default re-keying — see
		// `ReExportJson`); the surface is keyed by name, so the first edge in
		// sort order wins and the collider is dropped
		for (const edge of mod.reExports) {
			if (entries.has(edge.name)) continue;
			const canonical = byIdentity.get(`${edge.module}\n${edge.name}`);
			entries.set(edge.name, {
				entry: {
					name: edge.name,
					via: 'reExport',
					module: edge.module,
					...(canonical ? {declaration: canonical} : {}),
					...(edge.typeOnly ? {typeOnly: true} : {}),
				},
				identity: canonical
					? resolveCanonicalIdentity(byIdentity, edge.module, canonical)
					: `${edge.module}\n${edge.name}`,
			});
		}

		// 3. Direct external re-exports
		for (const external of mod.externalReExports) {
			if (entries.has(external.name)) continue;
			entries.set(external.name, {
				entry: {
					name: external.name,
					via: 'external',
					specifier: external.specifier,
					...(external.originalName !== undefined ? {originalName: external.originalName} : {}),
					...(external.typeOnly ? {typeOnly: true} : {}),
				},
				identity: `ext\n${external.specifier}\n${external.originalName ?? external.name}`,
			});
		}

		// 4. External stars — names unknowable, surface incompleteness recorded
		for (const specifier of mod.externalStarExports) {
			surface.externalStars.add(specifier);
		}

		// 5. Star projection, with ES shadowing and ambiguity rules
		const excluded = new Set<string>();
		for (const target of mod.starExports) {
			if (!byPath.has(target)) {
				surface.unresolvedStars.add(target);
				continue;
			}
			const resolved = resolveModule(target);
			if (resolved.tainted) tainted = true;
			const sub = resolved.surface;
			for (const star of sub.unresolvedStars) surface.unresolvedStars.add(star);
			for (const star of sub.externalStars) surface.externalStars.add(star);
			for (const {entry, identity} of sub.entries.values()) {
				// `default` never projects — nor do canonical Svelte components,
				// which represent their file's default export (whether reached
				// as a declaration or through a re-export edge)
				if (entry.name === 'default') continue;
				if (entry.declaration?.kind === 'component' && !entry.declaration.aliasOf) continue;
				if (excluded.has(entry.name)) continue;
				const existing = entries.get(entry.name);
				if (existing) {
					// Explicit exports shadow; identical canonicals (diamond) merge
					if (existing.entry.via !== 'star' || existing.identity === identity) continue;
					// Ambiguous between two stars — excluded per ES semantics
					entries.delete(entry.name);
					excluded.add(entry.name);
					continue;
				}
				entries.set(entry.name, {
					entry: {...entry, via: 'star', starFrom: target},
					identity,
				});
			}
		}

		visiting.delete(modulePath);
		if (!tainted) cache.set(modulePath, surface);
		return {surface, tainted};
	};

	const resolved = resolveModule(path).surface;
	return {
		entries: Array.from(resolved.entries.values())
			.map(({entry}) => entry)
			.sort((a, b) => compareStrings(a.name, b.name)),
		unresolvedStarExports: Array.from(resolved.unresolvedStars).sort(compareStrings),
		externalStarExports: Array.from(resolved.externalStars).sort(compareStrings),
	};
};
