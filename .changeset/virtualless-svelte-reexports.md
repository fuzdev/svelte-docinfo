---
'svelte-docinfo': patch
---

fix: read re-exports of a component with no virtual by path

A re-export of a `.svelte` file that svelte2tsx couldn't transform (or that was never supplied) used to depend on whether some other component in the program imported `svelte`. Only then did TypeScript resolve the specifier, to `svelte`'s ambient `*.svelte` module. A relative `.svelte` specifier is now read by path, so these forms no longer depend on unrelated files: `export * from`, `export {default}` and `export {default as X} from`, `export * as ns from`, import-then-export (`import X from './Bad.svelte'; export {X}`, `export {X as default}`, `import * as ns`), and `export default X`, whether written in the re-exporting module or in a module the re-export goes through. Non-relative specifiers (a `paths` alias like `$lib/Bad.svelte`) still depend on them.

Output changes, some of them breaking for consumers that read these fields:

- `export * from './Bad.svelte'` over a component that failed to transform is a `starExports` entry naming its `partial` placeholder module (`'Bad.svelte'`), never an `externalStarExports` entry. A star over one that emits nothing (gated, never supplied) is dropped.
- `resolveExportSurface` reports a star over a `partial` module in `unresolvedStarExports`, since its bindings are unknown, so that field is no longer always empty for a whole analysis result.
- The default re-exports as a `partial` component with `aliasOf`, named as a valid component's would be (`default` for `export default X` and `export {X as default}`, the component's name for `export {default} from`), where some forms used to give a bare `variable` or nothing.
- A namespace over it (`export * as ns from`, `import * as ns` then `export {ns}`) documents as a `partial` namespace, where it used to give a bare `variable` or an `externalReExports` entry.
- Through another module (`export {X} from './x.ts'` where `x.ts` re-exports the component), a same-name re-export gets a `reExports` edge to that module when it emits, and a renamed or gated one a `partial` alias, as for a valid component, where these used to give bare variables or nothing.
- A `.svelte` specifier whose file doesn't exist (a typo) or lies outside the project documents nothing, where it used to give a bare `variable`, a `partial` component, or an external entry.
