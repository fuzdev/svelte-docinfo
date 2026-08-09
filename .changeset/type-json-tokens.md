---
'svelte-docinfo': minor
---

feat: `typeJsonToTokens` renders `TypeJson` trees; remove `findTypeReferences`/`buildTypeReferencePatterns`

- New `typeJsonToTokens(node)` (+ `TypeJsonToken`) flattens a
  `typeInfo`/`returnTypeInfo` tree into a render-ready token list — `name`
  tokens for linkable references (alias-carrying unions/intersections
  included), `code` tokens for terminal type text, `text` tokens for
  structural punctuation. The tokenizer owns spacing, separators,
  parenthesization, and tuple labels; what a token looks like stays the
  renderer's decision. `typeJsonToText(node)` is the concatenated plain-text
  form.
- **Breaking**: `findTypeReferences`/`buildTypeReferencePatterns` are removed
  (regex name-matching over flat type strings; unused ecosystem-wide).
  Migrate by rendering `typeInfo` via `typeJsonToTokens`, falling back to
  the flat string where the tree is absent.
