---
'svelte-docinfo': patch
---

fix: record each star-export target once

`export * from './x'` plus `export type * from './x'` now gives one `starExports` entry instead of two, and likewise for `externalStarExports`.
