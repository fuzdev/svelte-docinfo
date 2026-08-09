---
'svelte-docinfo': minor
---

feat: registry-recovered reference nodes carry `module`

`{kind: 'reference'}` nodes the alias registry recovers gain `module` — the
winning alias's declaring `ModuleJson.path` — for collision-exact linking;
only emitted modules register, so a `(module, name)` lookup can't dangle.
Registry-only: written-channel recoveries and checker-named references stay
module-less, so consumers handle absence. `TypeJsonToken` `name` tokens pass
it through. Additive and wire-compatible.
