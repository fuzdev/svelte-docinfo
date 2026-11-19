---
'svelte-docinfo': minor
---

break: `typeInfo`, `returnTypeInfo`, and predicate trees follow a site's written annotation instead of the checker's reading. A reference keeps the name and type arguments written (`x: Uuid` where it read as `string & Brand<"Uuid">`, `x: Action` where it read as `Action<ActionSpecUnion>`); a computed type (`keyof A`, `typeof a`, `A['b']`, a conditional, mapped, or template literal type) is `{kind: 'other', text}` over its source text, root included, where it read as what it computes to, unless the usual reading already names it; a written intersection over a union (`A & {b: 1}`) is an `intersection` of the written members, where it read as the distributed union. A registry hit still wins over a written generic it stands for. Type-alias declaration roots, a `typeof` over a package's value or in a Svelte component's script, JSDoc's remapped names (`{Object<K, V>}`), and a module-private alias's name keep the checker's reading; a tree the flat string already matches stays absent.

fix: references drop trailing type arguments identical to their parameter's default (`x: Action` where it read as `Action<ActionSpecUnion>`), keeping a bare node where the flat string prints them.

fix: a class's, enum's, or namespace's value side nested in a type (`Array<typeof A>`) is `{kind: 'other', text: 'typeof A'}`, where it read as a `reference` to the instance type.
