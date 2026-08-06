---
'svelte-docinfo': minor
---

fix: extract props and docs from JS (no `lang="ts"`) components

Previously JS components yielded `props: []` silently and lost their HTML
`@component` comment.

- props extract from the JSDoc `@type` on `$props()` — typedef references,
  `import('...')` types, optionality, `@property` descriptions, defaults,
  `$bindable`, snippet-typed props; untyped destructuring extracts from the
  typedef svelte2tsx synthesizes
- the HTML `@component` comment lands as `docComment` again — tags-only
  `@type`/`@typedef` blocks no longer claim the doc slot
- `@property` descriptions on typedef-declared symbols now flow through
  `parseComment` for all extractors, not just component props

Breaking API changes: `SvelteVirtualFile` replaces `lang` with `scriptKind`
(analysis output unchanged); `virtualFiles` values and
`AnalysisLanguageService.setFile(path, entry)` take `VirtualFileEntry`
(`{content, scriptKind?}`).

Caveats: a description block above a separate `/** @type {...} */` block
never attaches in the AST — use the HTML `@component` comment, or write the
description inside a typedef-referencing `@type` block. Legacy `export let`
components still extract zero props.
