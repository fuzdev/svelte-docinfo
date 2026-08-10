---
'svelte-docinfo': minor
---

**breaking:** rename `intersects` to `externalTypes`, and resolve import
renames in its entries

`TypeDeclarationJson.intersects` and `ComponentDeclarationJson.intersects` are
now `externalTypes`. The field stopped being about intersections when the
label walk learned to descend through heritage clauses and bare references —
it lists the external types whose properties are filtered out of `members` /
`props`, however the author composed them — and `externalTypes` is what the
extractor has always called it internally. Consumers rename the field; the
shape (`Array<string>`, default `[]`) is unchanged.

**Fix riding along:** an entry is now the name its module exports rather than
whatever local binding a rename introduced. `import type {Bag as B} from
'pkg'` beside `type Props = B & {…}` recorded `B`, a spelling that means
nothing outside the file that wrote it, so a consumer rendering the entry
produced a dangling identifier. The rule applies at every leaf, and matters
most at the ones the descent reaches: those are collected from the
*definition* site, a sibling module free to bind the bag under any name of its
own.

Resolution is one hop — the `ImportSpecifier`'s property name — deliberately.
The full alias chain ends at the declaration's own name, which a package
re-exporting under a new name (`export {Foo as Bar}`) never makes importable;
for the same reason a local re-export chain keeps the name that module
exports. A default import has no exported name to recover (the other end is
`default`) and is left alone. Substitution is textual and identifier-scoped,
so written type arguments survive intact (`ExtG<string>`), as does the
`&` / index-access text the field carries verbatim.

Entries carry no module, so the dedupe that collapses one bag spelled two ways
into a single contributor also collapses two *distinct* bags that share an
exported name. Membership is unaffected — both bags' properties are filtered
out of `props` / `members` either way; only the contributor list is lossy.
