---
'svelte-docinfo': minor
---

fix: read the HTML `@component` comment by line-start tag, warn when svelte2tsx disagrees

The HTML component comment was svelte2tsx's pick: the last HTML comment containing `@component` anywhere. A later comment that merely mentioned it, such as a `@module` comment with a backticked `` `@component` ``, took the slot, and a `@module` comment there left the component with no `docComment`. The analyzer now reads the first HTML comment with a line starting `@component`, the rule `@module` already follows, and parses it like an HTML module comment, so only a line-leading `@` starts a tag.

- A component with two `@component` comments documents with the first, no longer the last.
- A comment that only mentions `@component` mid-line no longer documents the component.
- A `<!--` inside `<script>` or `<style>` text, like a string literal, is no longer read as an HTML comment, for `@component` and `@module` alike.
- New warning `component_comment_mismatch`: svelte2tsx, and so editor hover, would document the component with a different comment. `line` points at svelte2tsx's pick. Not emitted when in-script JSDoc supplies the doc.
