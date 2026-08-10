---
'svelte-docinfo': patch
---

fix: indexed access over a local container descends to the accessed property

`type P = LocalMap['a']` composes whatever `LocalMap` holds at `'a'`, but the
label walk had no descent for indexed access: when the property's type was
wholly external, the leaf fallback emitted `LocalMap['a']` — a project-local,
possibly-unexported container name — into a field documented as naming
external contributors, and when the property's type mixed local and external
branches, the external properties dropped from `members` with no entry at
all.

The walk now descends through a *local* container's accessed property to its
written type, so both shapes record the actual bag (`ExtNamed`), single
string/numeric-literal indices supported and the container's type parameters
substituting like any other descent boundary. An external container is
unchanged — never descended, its written `SvelteHTMLElements['li']`-style
access text stays the right single entry. A local container with a non-literal
index keeps the old fallback, the same degradation a mapped local definition
gets.
