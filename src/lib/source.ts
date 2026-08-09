/**
 * Source file type predicates and path helpers.
 *
 * Pure functions for detecting file types by extension and extracting
 * component names from paths. No configuration dependency — these are
 * the building blocks used by `source-config.ts`.
 *
 * @see `source-config.ts` for configuration-aware functions (`isSource`, `extractPath`, etc.)
 * @see `analyze.ts` for consumers (`analyze`, `analyzeFromFiles`)
 *
 * @module
 */

/**
 * Analyzer type for source files.
 *
 * - `'typescript'` — TypeScript/JS files analyzed via TypeScript compiler API
 * - `'svelte'` — Svelte components analyzed via svelte2tsx + TypeScript compiler API
 * - `'css'` — CSS files included as modules with no declarations
 * - `'json'` — JSON files included as modules with no declarations
 */
export type AnalyzerType = 'typescript' | 'svelte' | 'css' | 'json';

/**
 * File information for source analysis.
 *
 * Provides file content to analysis functions from any source:
 * file system, build pipeline, or in-memory.
 *
 * Note: `content` is required to keep analysis functions pure (no hidden I/O).
 * Callers are responsible for reading file content before analysis.
 */
export interface SourceFileInfo {
	/** Absolute path to the file. */
	id: string;
	/** File content (required - analysis functions don't read from disk). */
	content: string;
	/**
	 * Pre-resolved absolute file paths of modules this file imports.
	 *
	 * **Opt-in optimization** — when supplied, the session treats this as the
	 * authoritative dependency set for the file and skips its own lex+resolve
	 * pass for this entry. Build-tool integrations (e.g., Gro's filer) that
	 * already maintain a dependency graph can hand it over directly instead of
	 * paying the lex+resolve cost twice.
	 *
	 * **Omit (undefined) → default behavior** — the session lexes import
	 * specifiers from `content` and resolves them via its `ImportResolver`.
	 * This is the right choice when the caller doesn't already have a graph.
	 *
	 * Only include resolved local imports — node_modules paths are filtered
	 * out at storage time by the configured `isSource` predicate either way.
	 *
	 * **Trust contract** — the session treats this array as authoritative and
	 * does not cross-check against the file's `content`. Edges declared here
	 * are accepted as-is, even if the source code doesn't actually import them;
	 * edges that *are* in `content` but missing from this array are silently
	 * omitted. The lex+resolve fallback path has no such hole — its edges are
	 * always grounded in syntactic imports. Build-tool integrations that
	 * supply this field own the correctness of the graph they hand over.
	 *
	 * Type-only imports (`import type {...}`) are the most common asymmetry
	 * versus the lex+resolve path: the default lex (`es-module-lexer`) keeps
	 * them; pre-resolved callers backed by a Gro-style filer typically drop
	 * them. Both are intentional within their respective contracts.
	 *
	 * Cache semantics: the session compares this array element-wise (shallow
	 * equality) against the snapshot stored from the prior call — a fresh
	 * array with identical contents cache-hits, while any length, element, or
	 * order difference invalidates. Callers that produce fresh arrays per
	 * call (e.g., Gro's `[...filer.dependencies.keys()]`) reuse the cache
	 * cleanly across persistent-session calls.
	 *
	 * Order is significant. Reordering without a content change is treated
	 * as a real change — sort upstream if you want order-insensitive caching.
	 * Map-iteration-order callers (e.g., a Gro filer emitting
	 * `[...filer.dependencies.keys()]`) are naturally stable across calls for
	 * the same content, so no defensive sort is needed there.
	 */
	dependencies?: ReadonlyArray<string>;
}

/**
 * Default analyzer resolver based on file extension.
 *
 * - `.svelte` → `'svelte'`
 * - `.ts`, `.js` → `'typescript'`
 * - `.css` → `'css'`
 * - `.json` → `'json'`
 * - Other extensions → `null` (skip)
 */
export const getDefaultAnalyzer = (path: string): AnalyzerType | null => {
	if (isSvelte(path)) return 'svelte';
	if (isTypescript(path)) return 'typescript';
	if (isCss(path)) return 'css';
	if (isJson(path)) return 'json';
	return null;
};

/**
 * Extract component name from a Svelte module path.
 *
 * @example
 * ```ts
 * getComponentName('Alert.svelte') // => 'Alert'
 * getComponentName('components/Button.svelte') // => 'Button'
 * ```
 */
export const getComponentName = (modulePath: string): string =>
	modulePath.replace(/^.*\//, '').replace(/\.svelte$/, '');

/**
 * Check if a path is a TypeScript or JS file.
 *
 * Includes both `.ts` and `.js` files since JS files are valid in TS projects.
 * Excludes `.d.ts` declaration files — use a custom `getAnalyzerType` to include them.
 */
export const isTypescript = (path: string): boolean =>
	(path.endsWith('.ts') && !path.endsWith('.d.ts')) || path.endsWith('.js');

/** Check if a path is a Svelte component file. */
export const isSvelte = (path: string): boolean => path.endsWith('.svelte');

/** Check if a path is a CSS file. */
export const isCss = (path: string): boolean => path.endsWith('.css');

/** Check if a path is a JSON file. */
export const isJson = (path: string): boolean => path.endsWith('.json');

/**
 * Suffix appended to `.svelte` file paths to create virtual TypeScript file paths.
 *
 * Used by svelte2tsx integration: `Component.svelte` → `Component.svelte.__svelte2tsx__.ts`.
 */
export const SVELTE_VIRTUAL_SUFFIX = '.__svelte2tsx__.ts';

/**
 * Strip the svelte2tsx virtual file suffix from a path, if present.
 *
 * Maps `Component.svelte.__svelte2tsx__.ts` back to `Component.svelte`.
 * Returns the path unchanged if the suffix is not present.
 */
export const stripVirtualSuffix = (path: string): string =>
	path.endsWith(SVELTE_VIRTUAL_SUFFIX) ? path.slice(0, -SVELTE_VIRTUAL_SUFFIX.length) : path;

/**
 * Suffix svelte2tsx appends to the synthesized component const/type alias
 * (`<Name>__SvelteComponent_`). One of the generated-identifier shapes
 * `isSvelte2tsxInternal` filters.
 */
export const SVELTE_COMPONENT_ALIAS_SUFFIX = '__SvelteComponent_';

/**
 * Whether a symbol name is an internal svelte2tsx identifier — a generated
 * name that must not appear in documentation output: `$$ComponentProps`,
 * `$$render`, `__sveltets_Render`, and the synthesized component class/type
 * alias `<ComponentName>__SvelteComponent_`. The one filter shared by the
 * Svelte export walk (`analyzeSvelteModule`) and the alias-registry pre-pass
 * (`buildAliasRegistry`), which both iterate a virtual's export table.
 */
export const isSvelte2tsxInternal = (name: string): boolean =>
	name.startsWith('$$') ||
	name.startsWith('__sveltets_') ||
	name.endsWith(SVELTE_COMPONENT_ALIAS_SUFFIX);
