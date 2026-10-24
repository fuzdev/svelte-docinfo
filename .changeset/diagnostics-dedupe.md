---
'svelte-docinfo': minor
---

feat: collapse identical diagnostics

Identical diagnostics now collapse to one: a symbol analyzed more than once (a renamed re-export's alias re-analyzes its canonical, a type alias over a class reads its members) no longer repeats the same warning at the same position.
