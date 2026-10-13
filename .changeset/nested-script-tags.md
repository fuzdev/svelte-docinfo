---
'svelte-docinfo': patch
---

fix: a `<script>` nested in the template is no longer taken for the component's script

Only a top-level `<script>` is a component's instance or module script, as in Svelte. One nested in an element, a block, or `<svelte:head>` (JSON-LD, an inline snippet) is an ordinary element, and is now ignored. Before, the first `<script>` in the file was read wherever it sat.

What changes when a nested `<script>` comes before the component's own:

- A legacy `export let` component gets its real props. Before, it had none, with no diagnostic.
- A legacy component with a `$$Props` type no longer lists its accessors (`export const`, `export function`) as props.
- `lang` is read from the component's own scripts, so a nested `<script lang="ts">` no longer makes a JavaScript component read as TypeScript and lose its JSDoc prop types.
- A `@module` comment is read from the component's own scripts, never a nested one.

`extractScriptContent` and `extractModuleScriptContent` follow the same rule.

`SvelteVirtualFile` has a new optional `scriptTags` field: the component's script tags, located once by `transformSvelteSource` and reused by every analysis.
