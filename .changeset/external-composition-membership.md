---
'svelte-docinfo': minor
---

**breaking:** membership filters by declaration origin at every granularity,
and every dropped contribution is attributable

External filtering used to be three mechanisms that disagreed: named
properties filtered per-symbol everywhere, index signatures only inside
intersections by a node-level branch test, and call/construct signatures not
at all. The gaps produced wrong output on both axes: `type P = ExtCallable &
{a}` emitted the package's `(call)` as a member of the local type, `type P =
ExtIndexOnly` emitted the external index signature at a bare root while named
properties at the same position filtered, and an external index signature
inherited through a local base (`LocalBase extends ExtIndex`) leaked past the
branch test — each with no `externalTypes` entry to account for it.

One rule now decides membership: a contribution — named property, index
signature, call/construct signature — is dropped when its declaration lives
in an external file, at roots, in intersections (tested per constituent type,
since merging two same-kind index signatures loses the declaration), and
through inheritance alike. Declaration-less contributions are kept: the
checker synthesizes mapped-instantiation index infos (`Record<string, X>`,
`Partial<Indexed>`, hand-written mapped types) with no declaration, and their
content flows from the written site, so `Record<string, LocalX>` keeps its
index signature with no extra machinery.

The `externalTypes` leaf test is now that same predicate applied per branch —
recorded when the branch's declared contributions are wholly external and at
least one exists — so a purely structural external branch (index-signature-only,
callable-only) is attributable where it used to vanish, membership and
attribution can't disagree, and `Partial<ExtBag>` still labels for its
dropped props while its synthesized index signature stays a member.

Interfaces get the companion coherence fix: call/construct signatures are now
own-only like every other interface member kind. `getCallSignatures()`
resolves inherited signatures, so `interface I extends ExtCallable` used to
enumerate the bag's `(call)` while enumerating none of its properties;
inherited signatures — local base and external bag alike — are no longer
members, and `extends` (plus `externalTypes` for external reach) points at
what they come from.
