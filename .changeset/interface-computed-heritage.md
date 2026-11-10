---
'svelte-docinfo': patch
---

fix: an interface documents the members a computed `extends` entry gives it

An interface that extends a computed type documented none of the members it gets from it, so `interface Foo extends z.infer<typeof S> {}`, the fix the docs recommend for `alias_lost`, came out with empty `members`. Now each `extends` entry that isn't a named interface or class (a mapped, conditional, or utility-type instantiation such as `Omit<Base, 'a'>` or `Partial<Base>`, an intersection, or an object type behind an alias) contributes what the same type documents as a type alias's members: its properties, its index signatures, and its call and construct signatures, with external-origin ones dropped and labeled in `externalTypes` as on an alias. Own members win a name, and otherwise the first `extends` entry with the name supplies it, as in TypeScript. The contributed members come after the own ones. Members inherited from a named interface or class are still left to that base, which `extends` names.
