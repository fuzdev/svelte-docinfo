/**
 * Type declaration for the `virtual:svelte-docinfo` virtual module
 * provided by the Vite plugin (`vite.ts`).
 *
 * Reference in your `app.d.ts`:
 *
 * ```ts
 * /// <reference types="svelte-docinfo/virtual-svelte-docinfo.js" />
 * ```
 *
 * ## Wire shape vs Zod output shape
 *
 * The module's shape is `AnalyzeResultJsonWire` — the input-side counterpart
 * to `AnalyzeResultJson`. The plugin serializes `modules` through
 * `compactReplacer`, which strips empty arrays and `false` values to keep the
 * bundle small. So fields like `declarations`, `members`, `props` that are
 * `.default([])` in the schema arrive as `undefined` on any module that has
 * none, and `.default(false)` booleans arrive as `undefined` when false.
 *
 * `ModuleJsonInput` (the `z.input` of `ModuleJson`) reflects this — its
 * default-bearing fields are optional. Consumers either use optional
 * chaining (`mod.declarations?.length`) or run the value through
 * `AnalyzeResultJson.parse({modules, diagnostics})` to restore defaults.
 *
 * `diagnostics` is serialized without the replacer, so the array is always
 * present and `Diagnostic` itself has no defaults to strip — the static
 * type matches the runtime shape exactly.
 *
 * ## Why this file lives at the package root, not `src/lib/`
 *
 * The import below must stay the bare `'svelte-docinfo'` specifier, resolved
 * through the consumer's own install. `@sveltejs/package` rewrites aliased and
 * `#`-prefixed (`#lib/*`) imports in every file under `src/lib/`, including
 * hand-written `.d.ts`, to relative paths — and TypeScript doesn't resolve
 * relative imports inside ambient `declare module` blocks in consumer
 * projects, so types would silently collapse to `any`.
 *
 * Living at the root keeps the file out of `svelte-package`'s reach, so no
 * alias or subpath import can rewrite it;
 * `gro.config.ts` and `package.json` `files` re-register it for npm.
 * Do not "fix" this by moving the file into `src/lib/`.
 */
declare module 'virtual:svelte-docinfo' {
	import type { AnalyzeResultJsonWire } from 'svelte-docinfo';
	export const modules: AnalyzeResultJsonWire['modules'];
	export const diagnostics: AnalyzeResultJsonWire['diagnostics'];
	const data: AnalyzeResultJsonWire;
	export default data;
}
