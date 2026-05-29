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
 * The plugin serializes `modules` through `compactReplacer`, which strips
 * empty arrays and `false` values to keep the bundle small. So fields like
 * `declarations`, `members`, `props` that are `.default([])` in the schema
 * arrive as `undefined` on any module that has none, and `.default(false)`
 * booleans arrive as `undefined` when false.
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
 * `svelte.config.js` aliases `'svelte-docinfo' → 'src/lib'` (load-bearing
 * for fuz_ui's `library_gen`, a circular dev-dep). `@sveltejs/package`
 * applies that alias to every file under `src/lib/`, including hand-written
 * `.d.ts`, rewriting the `'svelte-docinfo/...'` imports below to relative
 * paths. TypeScript doesn't resolve relative imports inside ambient
 * `declare module` blocks in consumer projects — types silently collapse
 * to `any`.
 *
 * Living at the root keeps the file out of `svelte-package`'s reach;
 * `gro.config.ts` and `package.json` `files` re-register it for npm.
 * Do not "fix" this by moving the file into `src/lib/`.
 */
declare module 'virtual:svelte-docinfo' {
	import type {ModuleJsonInput} from 'svelte-docinfo/types.js';
	import type {Diagnostic} from 'svelte-docinfo/diagnostics.js';
	export const modules: Array<ModuleJsonInput>;
	export const diagnostics: Array<Diagnostic>;
	const data: {modules: Array<ModuleJsonInput>; diagnostics: Array<Diagnostic>};
	export default data;
}
