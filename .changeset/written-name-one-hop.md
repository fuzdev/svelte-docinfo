---
'svelte-docinfo': patch
---

fix: written-name recovery stops at the exported name instead of the declaration's

Recovering an alias TypeScript dropped resolved the written type reference
through its whole alias chain, down to the declaration. A module that renames
on the way out breaks that: with `hop.ts` doing `export type {Inferred as
Public}`, an annotation of `Public` recovered `{kind: 'reference', name:
'Inferred'}` — a name `hop.ts` does not export. Written-channel references
carry no `module`, so the name is the whole of what a consumer has to resolve,
and this one didn't match the import path they'd be resolving it against.

Recovery now stops at the nearest specifier's published name. `Public` stays
`Public`, a rename of it (`import type {Public as R}`) resolves one hop to
`Public` rather than the local `R`, and a namespace-qualified `ns.Public` —
which reaches the re-export directly rather than through an import binding —
lands on `Public` as well. Only an alias naming no export, a default or
namespace import, still falls through to the chain, where the declaration's
own name is the only name there is. Unrenamed imports, references the checker
already names, registry-recovered names, and every flat `typeSignature` /
`returnType` are untouched.

This is the rule `externalTypes` entries already follow for their import
renames, now one shared primitive behind both channels — extended to read an
`ExportSpecifier` as well, where the published name sits on the opposite side
of the `as` from an `ImportSpecifier`'s.
