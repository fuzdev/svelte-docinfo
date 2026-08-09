/**
 * Alias-registry pre-pass — builds the identity-keyed `AliasRegistry` the
 * `TypeJson` builder consults at nameless positions (see
 * `typescript-extract-type-json.ts` for the registry types and the consult
 * policy).
 *
 * `buildAliasRegistry` walks the export tables of the emitted modules and
 * registers each exported, non-`@nodocs`, non-generic type alias whose alias
 * the checker dropped (`isAliasLostType`) and whose resolved type passes the
 * safety gate (`containsAnonymousComponent`). It runs before declaration
 * extraction — checker caches make the duplicate `getTypeAtLocation` cheap —
 * and the registry is query-scoped: built per analysis cycle, discarded
 * after, so sessions never pin stale-program type objects.
 *
 * Deliberately an exported, independently callable function rather than a
 * private step of `analyzeCore`: the fixture harnesses don't route through
 * `analyzeCore`, so they build and thread the registry themselves — without
 * that seam their committed baselines would silently lock the no-registry
 * path.
 *
 * @internal Used by `analyzeCore` and the test harnesses — not part of the
 * public barrel export.
 *
 * @module
 */

import ts from 'typescript';

import { compareStrings } from './postprocess.ts';
import { isSvelte2tsxGeneratedExport, isSvelteVirtualPath, stripVirtualSuffix } from './source.ts';
import { parseComment } from './tsdoc.ts';
import {
	getLocalExportStatement,
	isDeclaredInFile,
	selectDeclarationNode
} from './typescript-extract-shared.ts';
import {
	isAliasLostType,
	namedSymbolName,
	unionMemberSetKey,
	type AliasRegistry,
	type AliasRegistryEntry
} from './typescript-extract-type-json.ts';

/**
 * One emitted module offered to the pre-pass: the program's source file (for a
 * Svelte module, the svelte2tsx *virtual* — `program.getSourceFile` returns
 * `undefined` for a raw `.svelte` id, so the caller resolves through
 * `virtualPath`) and its `ModuleJson.path`, which becomes
 * `AliasRegistryEntry.module` and ships verbatim on recovered reference
 * nodes — `analyzeCore` derives it with the same `extractPath` call that
 * mints `ModuleJson.path`, and `normalizeModulePathsInTypes` deliberately
 * skips the `module` key, so a caller passing anything else (an absolute
 * path, a virtual-suffixed one) would publish it unrewritten.
 */
export interface AliasRegistrySource {
	sourceFile: ts.SourceFile;
	modulePath: string;
}

/**
 * Depth bound for the safety-gate walk, alongside the seen-set — the set is
 * what terminates cycles (zod 4's documented recursive getter pattern produces
 * cyclic lost types that overflow an unguarded walk); the bound caps
 * pathological non-cyclic nesting.
 */
const MAX_GATE_WALK_DEPTH = 10;

/**
 * The safety gate: whether a type recursively contains at least one component
 * the checker cannot name — an anonymous object/function/mapped shape, keyed
 * on `namedSymbolName`'s `__`-prefix rule (never `ObjectFlags.Anonymous`: real
 * zod outputs are `Mapped | Instantiated`, not `Anonymous`).
 *
 * Two things ride on it:
 *
 * - **Identity safety.** Object types are origin-unique — structurally
 *   identical but separately written types are distinct type objects — and a
 *   union/tuple/instantiation containing one inherits that uniqueness, so an
 *   identity match means genuinely the same origin. Interned compositions of
 *   interned parts (primitive unions — a schema-derived `string | number` is
 *   the *same object* as an unrelated site's; unlabeled primitive tuples;
 *   `string[]`) must never register, or the registry would relabel every
 *   unrelated occurrence in the project.
 * - **Worthwhileness.** A nameless-but-readable composition of named types
 *   (`User | null`) is identity-accurate to relabel but gratuitous — the
 *   expansion already prints names, so a nameable component stops the walk
 *   instead of qualifying.
 */
const containsAnonymousComponent = (
	type: ts.Type,
	checker: ts.TypeChecker,
	seen: Set<ts.Type>,
	depth: number
): boolean => {
	if (depth > MAX_GATE_WALK_DEPTH) return false;
	if (seen.has(type)) return false;
	seen.add(type);
	// an aliased component prints by its alias name — readable, stop
	if (type.aliasSymbol !== undefined) return false;
	if (type.isUnion() || type.isIntersection()) {
		return type.types.some((t) => containsAnonymousComponent(t, checker, seen, depth + 1));
	}
	if (!(type.flags & ts.TypeFlags.Object)) return false;
	// tuples carry no symbol of their own — they are containers here, not the
	// anonymous component (a labeled primitive tuple stays unregistered), and
	// arrays print their element inline, so both recurse
	if (checker.isTupleType(type) || checker.isArrayType(type)) {
		return checker
			.getTypeArguments(type as ts.TypeReference)
			.some((t) => containsAnonymousComponent(t, checker, seen, depth + 1));
	}
	if (namedSymbolName(type) === undefined) return true;
	// a named instantiation prints `Name<args>` with the args expanded inline —
	// recurse them; a plain named type (interface/class/enum) prints its name
	if ((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) {
		return checker
			.getTypeArguments(type as ts.TypeReference)
			.some((t) => containsAnonymousComponent(t, checker, seen, depth + 1));
	}
	return false;
};

/** Whether a declaration node carries `@nodocs` — the one exclusion check for all three JSDoc positions the walk reads. */
const hasNodocs = (node: ts.Node): boolean =>
	parseComment(node, node.getSourceFile())?.nodocs === true;

/** Whether `next` beats `incumbent` under the global-single-winner tie-break. */
const winsTieBreak = (next: AliasRegistryEntry, incumbent: AliasRegistryEntry): boolean => {
	const byName = compareStrings(next.name, incumbent.name);
	if (byName !== 0) return byName < 0;
	return compareStrings(next.module, incumbent.module) < 0;
};

/**
 * Build the alias registry for one analysis cycle.
 *
 * Registration walks each source's export table and registers an export when
 * it:
 *
 * - survives the svelte2tsx filters on virtuals (`default` and generated
 *   `$$`/`__sveltets_` names skipped)
 * - is declared in the file (star-projected bindings skipped, mirroring
 *   `analyzeExports`'s locality rule)
 * - resolves — through local export clauses, `@nodocs`-free ones only — to a
 *   `TypeAliasDeclaration` in the *same* file (a re-export of another module's
 *   alias registers from that module when it's emitted, and never when it's
 *   gated — gated aliases have no doc page for a reference to land on;
 *   merged value+type symbols select the type-space node via
 *   `selectDeclarationNode`)
 * - is non-generic (instantiations are per-argument type objects — the
 *   declared type of a generic alias never matches a use site)
 * - carries no `@nodocs` on either declaration of a merged pair
 * - is alias-lost (`isAliasLostType`) and passes the safety gate
 *
 * Ambiguity — two aliases over one lost type (`type A = z.infer<typeof S>`
 * beside `type B` of the same, `z.infer` vs `z.output`, cross-module,
 * `type A = B` over a lost `B`) resolves to a **global single winner** via
 * `compareStrings` on name then module, so one type documents under one name
 * everywhere (coherent cross-linking, deterministic regardless of iteration
 * order). The member-set side index is derived from the settled winners, so
 * the two indexes can't disagree.
 *
 * @param sources - the emitted modules (Svelte modules via their virtuals — see `AliasRegistrySource`)
 * @param checker - the program's type checker (registry entries are valid exactly as long as this checker's types are)
 */
export const buildAliasRegistry = (
	sources: ReadonlyArray<AliasRegistrySource>,
	checker: ts.TypeChecker
): AliasRegistry => {
	const byType = new Map<ts.Type, AliasRegistryEntry>();

	for (const { sourceFile, modulePath } of sources) {
		const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
		if (!moduleSymbol) continue;
		const isVirtual = isSvelteVirtualPath(sourceFile.fileName);
		const currentFileName = stripVirtualSuffix(sourceFile.fileName);

		for (const exportSymbol of checker.getExportsOfModule(moduleSymbol)) {
			const name = exportSymbol.name;
			if (isVirtual && isSvelte2tsxGeneratedExport(name)) continue;
			if (!isDeclaredInFile(exportSymbol, currentFileName)) continue;

			let resolved = exportSymbol;
			if (exportSymbol.flags & ts.SymbolFlags.Alias) {
				// a local export clause can carry statement-level @nodocs — the
				// declaration is excluded from docs, so its name must not register
				const local = getLocalExportStatement(exportSymbol, sourceFile);
				if (local && hasNodocs(local.statement)) continue;
				try {
					resolved = checker.getAliasedSymbol(exportSymbol);
				} catch {
					continue;
				}
			}

			const declNode = selectDeclarationNode(resolved);
			if (!declNode || !ts.isTypeAliasDeclaration(declNode)) continue;
			// canonical declared elsewhere: its own module's walk registers it (or
			// deliberately doesn't, when that module is gated from output)
			if (stripVirtualSuffix(declNode.getSourceFile().fileName) !== currentFileName) continue;
			if (declNode.typeParameters?.length) continue;
			if (hasNodocs(declNode)) continue;
			// merged value+type pair: @nodocs on either declaration suppresses,
			// matching analyzeDeclaration's rule
			const valueNode = resolved.valueDeclaration;
			if (valueNode && valueNode !== declNode && hasNodocs(valueNode)) continue;

			let type: ts.Type;
			try {
				type = checker.getTypeAtLocation(declNode);
			} catch {
				continue;
			}
			if (!isAliasLostType(type)) continue;
			if (!containsAnonymousComponent(type, checker, new Set(), 0)) continue;

			const entry: AliasRegistryEntry = { name, module: modulePath };
			const incumbent = byType.get(type);
			if (!incumbent || winsTieBreak(entry, incumbent)) byType.set(type, entry);
		}
	}

	// side index off the settled winners, unions only — see
	// `AliasRegistry.byMemberSet` for what it recovers
	const byMemberSet = new Map<string, AliasRegistryEntry>();
	for (const [type, entry] of byType) {
		if (!type.isUnion()) continue;
		const key = unionMemberSetKey(type);
		if (key !== undefined) byMemberSet.set(key, entry);
	}

	return { byType, byMemberSet, warnedAliasLost: new Set() };
};
