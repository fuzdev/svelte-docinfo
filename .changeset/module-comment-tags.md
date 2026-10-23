---
'svelte-docinfo': minor
---

**breaking:** parse module-comment tags into `ModuleJson` fields

A `@module` comment's tags used to stay in `moduleComment` as literal text, so `@see`, `@example`, and the rest rendered verbatim on docs sites. Module comments now parse with the same tag parser as declarations, in TS files and in all three Svelte sources (instance `<script>`, `<script module>`, and the HTML `<!-- @module -->` comment):

- `moduleComment` holds only the comment's prose, with every tag line removed. It's absent when the comment is tags alone. Prose written after a tag belongs to that tag, as in a declaration's JSDoc.
- New `ModuleJson` fields, with the same names, defaults, and meaning as on declarations: `examples` and `seeAlso` (default `[]`), `deprecatedMessage`, `internalMessage` (`''` for a bare tag), and `since`.
- Tags that only describe a declaration (`@param`, `@returns`, `@mutates`, `@throws`, `@default`, and `@nodocs` as before) are dropped from a module comment with a `misplaced_tag` warning. `MisplacedTagDiagnostic.tagName` gains `'param'` and `'returns'`. Unknown tags are dropped silently.
- In a module comment, only an `@` that starts a line starts a tag, so a mid-line `@` (`` `// @foo` ``, `x @> y`) stays in the text. A declaration's JSDoc still follows TypeScript, which starts a tag at any `@` after whitespace.
- In a Svelte file, a module comment of tags alone now counts as a source for `duplicate_comment` and can win the priority order. A bare `@module` comment still doesn't count, and one holding only dropped tags (`/** @nodocs @module */`) yields to a lower-priority comment that documents the module. The `duplicate_comment` message names the source used instead of "Using first found."
- An HTML `<!-- @module -->` comment keeps its relative indentation: the lines' common indentation is removed instead of trimming each line, so an indented `@example` keeps its shape.
- A JSDoc block is a module comment only when a line starts with `@module`. A mid-line mention (`` an HTML `<!-- @module -->` comment ``) used to make TypeScript's parse treat the block as a module block, so the declaration below lost its whole doc comment while no module comment was extracted either; the declaration keeps it now, up to the mention (a declaration's JSDoc still ends its text at a mid-line `@`, as TypeScript reads it).

For library users: `extractModuleComment`, `extractSvelteModuleComment`, and `extractHtmlModuleComment` return the parsed comment (`TsdocParsedComment`) instead of a string, `ModuleExportsAnalysis.moduleComment` is replaced by `moduleDoc`, and `warnModuleCommentNodocs` is replaced by `warnModuleCommentTags`. `tsdoc.ts` adds `parseCommentText`, `parseModuleComment`, `hasModuleTag`, `toModuleDocFields`, and the `ModuleDocFields` type.

Inline `{@link}` tags now keep their source text everywhere, declarations included. TypeScript's reprint added a space to a link whose target isn't an entity name (`{@link ./x.ts}` became `{@link  ./x.ts}`) and before a `|` (`{@link url|text}` became `{@link url |text}`).
