---
'svelte-docinfo': minor
---

fix: emit component props in source order

Props were emitted in the checker's property order, which visibly interleaves
the authored declaration order and is unrecoverable client-side. `props` now
follows declaration position: same-file properties by source offset,
cross-file groups by file path, declarationless symbols last by name. Note
that cross-file grouping is by path, not "the component's own file first" —
props inherited from a project-local base interface land before or after the
local ones depending on how the two paths compare.
