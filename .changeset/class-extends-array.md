---
'svelte-docinfo': minor
---

**breaking:** `ClassDeclarationJson.extends` is an array

Was `string | undefined`; now `Array<string>` with 0 or 1 entries
(TypeScript allows one base class): `"extends": "Base"` → `"extends":
["Base"]`, with `.default([])` like the other array fields so empty arrays
strip on the wire and `.parse()` restores them. Every heritage field —
class `extends`/`implements`/`externalTypes`, interface
`extends`/`externalTypes` — now shares one shape, so consumers iterate
heritage uniformly instead of branching on declaration kind or normalizing
with `Array.isArray`. Entries stay verbatim own-clause text.
