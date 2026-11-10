---
'svelte-docinfo': patch
---

fix: declaration maps resolve to the source path, so go-to-definition in a linked checkout lands in `src/lib`

A `dist/*.d.ts.map` named its source under a `src/src/lib/` path that never exists, so an editor's go-to-definition stopped at the `.d.ts`. It now names the module in `src/lib`. The package ships `dist` only, not `src/lib`, so this helps where the source sits beside `dist`, as in a linked or workspace checkout; an installed package still goes to the `.d.ts`.
