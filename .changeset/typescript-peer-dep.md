---
'svelte-docinfo': minor
---

chore: move `typescript` to peer dependencies

Breaking for consumers without `typescript` installed (npm 7+ auto-installs
peers, so most setups need no change). Same `^5.9.3` range, now matching how
`svelte`, `svelte2tsx`, and `zod` are handled — consumers with their own TS
(build tools, editor tooling) no longer carry a second instance in the tree.
