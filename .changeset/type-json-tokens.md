---
'svelte-docinfo': minor
---

feat: `typeJsonToTokens` renders `TypeJson` trees; remove `findTypeReferences`/`buildTypeReferencePatterns`

- New `typeJsonToTokens(node)` (+ `TypeJsonToken`) in `declaration-helpers.ts`
  flattens a `typeInfo`/`returnTypeInfo` tree into a render-ready token list —
  `name` tokens for linkable references (including alias-carrying
  unions/intersections), `code` tokens for terminal type text, `text` tokens
  for structural punctuation. Spacing, separators, parenthesization, and
  tuple labels are decided by the tokenizer in lockstep with the `TypeJson`
  schema; what a token looks like stays the renderer's decision.
  `typeJsonToText(node)` is the concatenated plain-text form, for consumers
  with no linkification surface (CLI output, markdown, logs).
- **Breaking**: `findTypeReferences` and `buildTypeReferencePatterns` are
  removed. They discovered linkable names in flat type strings via regex
  identifier matching (false-positive-prone, no positions) and were unused
  ecosystem-wide; the structured tree + tokenizer does the same job per-node
  and exactly. Consumers linkifying types should render `typeInfo` via
  `typeJsonToTokens` and fall back to the flat string where the tree is
  absent.
