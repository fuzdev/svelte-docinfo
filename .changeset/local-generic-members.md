---
'svelte-docinfo': patch
---

fix: local generic instantiations extract members

`hasExtractableProperties` gated out every Reference-flagged non-mapped type
to keep `Array<T>`/`Promise<T>` prototype surfaces out of `members`, which
also swallowed instantiations of the project's *own* generic types: `type X =
LocalGen<string>` emitted no members, and when the generic base reached an
external bag (`interface LocalGen2<T> extends ExtNamed`), the early return
ran before external filtering, so one type parameter erased the whole
declaration — no members, no `externalTypes`, no diagnostic, while the
non-generic twin documented fully.

The gate now admits generic references whose target declarations are all
project-local: instantiated members extract (`a: T` documents as `a: string`)
and external filtering runs, so members and attribution both survive.
External targets stay gated — a lib type's prototype surface is not the
author's shape.
