---
'svelte-docinfo': minor
---

fix: emit component props in source order

Props were emitted in the checker's property order, which visibly
interleaves the authored declaration order and is unrecoverable
client-side. `props` now follows declaration position: same-file properties
by source offset, cross-file groups by file path, declarationless symbols
last by name. One pick rule decides which declaration represents a prop —
the symbol's declaration in the component's own file when one exists — and
the sort key, the prop's JSDoc, the written annotation feeding `typeInfo`
name recovery, and diagnostic position mapping all read it. In
`HTMLAttributes<HTMLElement> & {status?: string; onclick?: () => void;
children: Snippet}` the redeclared `onclick`/`children` symbols also carry
the bag's node_modules declarations; keying on those would jump them ahead
of `status` and lose the author's JSDoc written on the redeclared name.
Cross-file grouping for genuinely-inherited props is by path, not "the
component's own file first" — a prop inherited from a project-local base
interface lands before or after the local ones depending on how the two
paths compare.
