---
'svelte-docinfo': minor
---

feat: `externalTypes` on interfaces and classes

The common library shape — export the props interface *and* use it in the
component — used to produce two answers in one module: the component's
`externalTypes` resolved through local bases transitively while the exported
interface beside it showed only its verbatim `extends`, which dead-ends when
the base is local and unexported. Interface members are own-only, so the
interface could not answer "what else does this accept" at all.

`InterfaceDeclarationJson` and `ClassDeclarationJson` now carry
`externalTypes` (`Array<string>`, default `[]`), fed by the same heritage
descent the component path runs: the external types the heritage composition
reaches whose contributions `members` never enumerates. `interface Props
extends HTMLButtonAttributes` records the bag beside its verbatim `extends`;
a bag behind a local base chain records transitively — the same answer the
component annotated with that interface gets. Classes walk the `extends`
chain only, descending local base classes; `implements` contributes nothing
(an implemented interface adds no members — the class declares its own).
Entry normalization matches the existing field: rename resolution,
type-parameter substitution, text-dedupe, source order.

`extends` and `implements` are unchanged — verbatim own-clause text, the
local spelling that resolves in the declaring module. On direct external
heritage the two fields are textually equal by design; consumers that render
both dedupe at display time.
