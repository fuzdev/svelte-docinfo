---
'svelte-docinfo': minor
---

fix: detect legacy `export let` components instead of failing silently

Runes-less components (still-legal Svelte 5 syntax) have no `$props()`
declaration to anchor prop extraction on, so they produced zero props with no
diagnostic — and the first documented `export let`'s JSDoc leaked into the
component `docComment`. Now:

- a new `legacy_props` warning diagnostic reports the component and its
  legacy prop names (`export let`/`export var` declarations plus
  export-clause renames of mutable bindings like `export {a as b}`;
  `export const`/`export function` accessors and type-only exports are not
  props and stay silent), with `line` pointing at the first legacy export in
  the original `.svelte` source
- the in-script `docComment` walk is gated on the `$props()` anchor: with no
  `$props()`, the HTML `@component` comment is the only `docComment` source.
  Besides the legacy leak, this also fixes propless runes components, where a
  documented local (`/** ... */ let a = $state(0)`) could claim the component
  doc slot

Legacy props are still not extracted — migrate to `$props()` for prop
extraction.
