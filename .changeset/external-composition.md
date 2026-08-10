---
'svelte-docinfo': minor
---

**breaking:** rename `intersects` to `externalTypes`, put it on interfaces and
classes, and make membership and attribution one model

`TypeDeclarationJson.intersects` and `ComponentDeclarationJson.intersects` are
now `externalTypes`. The field long since stopped matching its name: it has
covered bare references and indexed access alongside intersections for some
time, and now heritage clauses and the local composition behind them. What it
lists is the external types whose contributions are filtered out of `members` /
`props`, however the author composed them. Consumers rename the field; the
shape (`Array<string>`, default `[]`) is unchanged.

`InterfaceDeclarationJson` and `ClassDeclarationJson` gain the same field. The
common library shape — export the props interface *and* use it in the component
— used to give two answers in one module: the component resolved through local
bases transitively while the exported interface beside it showed only its
verbatim `extends`, which dead-ends when the base is local and unexported.
Interface and class members are own-only, so nothing is filtered there; the
field names the external types the heritage composition reaches whose
contributions `members` therefore never enumerates. Classes walk `extends`
only — an implemented interface adds no members. `extends` / `implements` are
unchanged verbatim own-clause text; on direct external heritage the two fields
are textually equal by design, and consumers that render both dedupe at
display time.

### Membership: one rule at every granularity

External filtering used to be three mechanisms that disagreed. Named properties
filtered per-symbol everywhere, index signatures only inside intersections by a
node-level branch test, and call/construct signatures not at all — so
`type P = ExtCallable & {a}` emitted the package's `(call)` as a member,
`type P = ExtIndexOnly` emitted the external index signature at a bare root
while named properties at the same position filtered, and an external index
signature inherited through a local base leaked past the branch test. Each with
no `externalTypes` entry to account for it.

One rule now decides membership: a contribution — named property, index
signature, call/construct signature — is dropped when its declaration lives in
an external file, at roots, in intersections (tested per constituent, since
merging two same-kind index signatures loses the declaration), and through
inheritance alike. Declaration-less contributions are kept: the checker
synthesizes mapped-instantiation index infos (`Record<string, X>`,
`Partial<Indexed>`, hand-written mapped types) with no declaration, and their
content flows from the written site.

The `externalTypes` leaf test is that same predicate applied per branch —
recorded when the branch's declared contributions are wholly external and at
least one exists — so a purely structural external branch (index-signature-only,
callable-only) is attributable where it used to vanish, declaration-less
contributions stay neutral in both directions, and membership and attribution
can't disagree.

Interfaces get the companion coherence fix: call/construct signatures are
own-only like every other interface member kind. `getCallSignatures()` resolves
inherited signatures, so `interface I extends ExtCallable` used to enumerate the
bag's `(call)` while enumerating none of its properties. Now that a signature is
always the interface's own, its TSDoc resolves through its own declaration like
the type-alias path does, so a signature written in a merged `interface` block
keeps its docs instead of silently losing them.

### Attribution: what the walk records

The labels come from an AST walk of the written type, so the `&` /
index-access text is preserved verbatim. Membership filtering is
inheritance-blind, so the walk is too — a leaf naming a **project-local** type
descends through that type's own composition, transitively, and contributes
whatever bags that reaches:

- a local interface's `extends` entries, a local alias's right-hand side, a
  local class's `extends` chain, imports followed to the declaring module — so
  `interface Props extends HTMLButtonAttributes` records the bag exactly like
  `type Props = HTMLButtonAttributes & {…}`, including behind an intermediate
  local type or a props type imported from a sibling module
- an indexed access over a *local* container descends to the accessed
  property's written type: `type P = LocalMap['a']` records the bag the
  property holds rather than emitting the container's own (possibly
  unexported) name, single string/numeric-literal indices supported. An
  external container is unchanged — `SvelteHTMLElements['li']` stays the right
  single entry
- the root is walked as written, so a bare reference to a local alias reaches
  the leaf fallback with its written type arguments intact

Only when the descent comes back empty does a leaf fall back to its own text,
and then only if wholly external by the leaf test. External names are never
descended into (an external base chain stays one entry, no node_modules-internal
definition leaks), and a local name surfaces only when it hides a definition the
walk can't traverse — a mapped or conditional type.

Two normalizations make an entry mean the same thing at the documented site as
where it was written, both textual and identifier-scoped so written argument
lists and the field's `&` / index-access shape survive:

- **Import renames resolve to the exported name.** `import type {Bag as B}`
  beside `type Props = B & {…}` recorded `B`, a spelling that means nothing
  outside the file that wrote it. Resolution is one hop — the
  `ImportSpecifier`'s property name — deliberately: the full alias chain ends at
  the declaration's own name, which a package re-exporting under a new name
  (`export {Foo as Bar}`) never makes importable. A default import has no
  exported name to recover and is left alone. This matters most at the leaves
  the descent reaches, collected from a *definition* site free to bind the bag
  under any name of its own.
- **Type parameters bound inside the descent substitute their written
  argument.** `interface A<T> extends ExtG<T>` reached via `Props extends
  A<string>` records `ExtG<string>`, not the wrapper's name — the hottest gap
  in a corpus survey of published Svelte libraries, where generic base
  interfaces and `Without<T, U>`-style local utilities bind the attribute bag
  to a type parameter. Arguments render at their own site first (outer
  substitutions and renames applied) so chained generics compose; an omitted
  argument takes its declared default. A parameter with neither still degrades
  to no entry rather than emitting text that dangles at the documented site.

A type parameter in scope at the annotation site itself — a generic component's
own — still emits as written, beside the `genericParams` documenting it.
Descending in preference to the name is what keeps a local name out of a field
that names external contributors: an attribute-forwarding `interface Props
extends Bag {}`, every property inherited, records `Bag` rather than `Props`.
Each distinct contributor appears once, in source order. Entries carry no
module, so the dedupe that collapses one bag spelled two ways also collapses two
*distinct* bags sharing an exported name; membership is unaffected either way.

A path-scoped seen-set terminates cycles and `MAX_COMPOSITION_DEPTH` bounds a
long acyclic chain of distinct local aliases; past the bound the reference in
hand names itself, the degradation an untraversable definition already gets.
Scoping note: an interface's or class's own field reads the processed
declaration's heritage clauses — the same node `extends` and `members` come
from — so on a merged interface only the selected block contributes, while a
*reference* to that interface descends every block.

### Local generic instantiations extract members

`hasExtractableProperties` gated out every Reference-flagged non-mapped type to
keep `Array<T>` / `Promise<T>` prototype surfaces out of `members`, which also
swallowed instantiations of the project's *own* generic types: `type X =
LocalGen<string>` emitted no members, and when the generic base reached an
external bag (`interface LocalGen2<T> extends ExtNamed`), the early return ran
before external filtering, so one type parameter erased the whole declaration —
no members, no `externalTypes`, no diagnostic, while the non-generic twin
documented fully.

The gate now admits generic references whose target declarations are all
project-local: instantiated members extract (`a: T` documents as `a: string`)
and external filtering runs. External targets stay gated — a lib type's
prototype surface is not the author's shape.

### Class visibility follows the class through an alias

`private` and `#` members are excluded from a class's own `members`, but a
structural container naming that class projected its *type*, which has no such
filter — `type X = LocalClass` published `secret` and `#hard` beside the public
shape, and admitting local generic instantiations extended that to
`type X = LocalGen<string>`. Both paths now share one rule, so an alias hides
exactly what the class hides; `protected` stays on both, as part of the
extension API. Only classes can declare either form, so nothing else changes.

Two `@internal` extractor helpers are renamed to match what they now do —
`filterExternalProperties` → `filterDocumentedProperties` (the property
chokepoint, which decides two axes) and `collectExternalTypesFromHeritage` →
`applyHeritageExternalTypes` (it sets the field rather than returning it).
Neither is barrel-exported.
