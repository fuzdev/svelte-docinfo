---
'svelte-docinfo': patch
---

fix: `externalTypes` records external types reached through `interface Props extends Bag`

Inherited properties from an external attribute bag are filtered out of a
component's `props` (and a type alias's `members`) whichever way the author
composes them, but only the inline `Bag & {…}` form was recorded in
`externalTypes` — the `extends` form left no trace, so a consumer could not
render "also accepts button attributes". `interface Props extends
HTMLButtonAttributes` now records `HTMLButtonAttributes` exactly like
`type Props = HTMLButtonAttributes & {…}`. Multiple heritage entries each
appear, in source order; a generic base keeps its written form
(`HTMLAttributes<HTMLDivElement>`).

The labels come from a walk of the written AST, which a heritage clause never
entered. The walk now descends through project-local names generally — a
local interface's `extends` entries, a local alias's right-hand side,
transitively, imports followed to the declaring module — so the recovery also
covers a bag composed behind an intermediate local type, or behind a props
type imported from a sibling module, the form published Svelte libraries use
most. The property filtering these labels pair with is inheritance-blind, so
the labels had to be too. A bag reached by two branches is recorded once.

Two output changes ride along. A leaf naming a *local* type now prefers the
external types behind the name over the name itself: an attribute-forwarding
`interface Props extends Bag {}` — every property inherited, none of its own
— records `Bag` rather than its own `Props`, and a local alias over a utility
type records `Omit<Bag, 'onclick'>` rather than the alias name. A local name
whose definition the walk cannot traverse (a mapped or conditional type)
still falls back to naming itself, so nothing recorded before is dropped.

Two boundaries keep the recovery honest. External names are never descended
into: an external base chain stays one entry, and no node_modules-internal
definition leaks through. And text collected past a declaration boundary that
names that declaration's own type parameters is never emitted — `interface
A<T> extends HTMLAttributes<T>` reached via `Props extends A<HTMLDivElement>`
puts `HTMLAttributes<T>` in hand, `T` dangling at the documented site — so
recovery degrades to the nearest enclosing well-formed name
(`A<HTMLDivElement>` when every property is external) or to no entry. A type
parameter in scope at the annotation site — a generic component's own — still
emits, beside the `genericParams` that document it.

A path-scoped seen-set terminates cycles, and a depth bound of 10 declaration
boundaries (matching the alias registry's containment walk) terminates a long
acyclic chain of distinct local aliases. Past the bound the reference in hand
is treated as untraversable and names itself, the degradation a mapped or
conditional definition already gets.
