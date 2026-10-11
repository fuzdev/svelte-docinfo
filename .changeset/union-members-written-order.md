---
'svelte-docinfo': patch
---

fix: list union members in `typeInfo` in the order they were written

TypeScript orders a union's members by when each member type was first created anywhere in the program, not by how the union was written, so `align?: 'start' | 'end' | 'top' | 'bottom'` could document as `"top" | "start" | "end" | "bottom"`, and an unrelated edit could reorder it. `typeInfo` and `returnTypeInfo` trees now list union members in written order: the alias declaration's order for an aliased union, at every use, inferred ones included, and otherwise the order of the annotation at that position. `null` and `undefined` still come last, and a member written as a named alias still appears as its own node, now at its written position (`Size | 'x'` no longer reads `"x" | Size`). Unions with no written form (inferred types, `keyof`, mapped and conditional results, generic alias instantiations) keep TypeScript's order.

Flat type strings (`typeSignature`, `type`, `returnType`) are unchanged and still print in TypeScript's order, so a tree and its flat string can list the same members in different orders. Read the tree for the author's order, such as control options.
