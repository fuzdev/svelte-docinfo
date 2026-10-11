---
'svelte-docinfo': minor
---

**breaking:** duplicate-name detection is opt-in: without `onDuplicates`, no `duplicate_declaration` diagnostics are emitted

The check is for packages that keep a flat export namespace (every exported name unique across modules), and in most packages two modules exporting the same name is ordinary. Pass `onDuplicates: 'diagnostic'` (CLI: `--on-duplicates diagnostic`) for the previous default: the diagnostics, without logging or throwing. `'warn'` and `'throw'` emit the diagnostics too, as before, and `'warn'` now logs through `log.warn` instead of `log.error`.

The callback form of `onDuplicates` is removed, with its `OnDuplicatesCallback` type: for custom handling, pass `'diagnostic'` and read the records with `byKind(diagnostics, 'duplicate_declaration')`. `throwOnDuplicates` is removed too (use `onDuplicates: 'throw'`). `findDuplicates` and `DuplicateDeclaration` are no longer exported from the main entry; import them from `svelte-docinfo/postprocess.js`. The duplicate error message no longer suggests `@nodocs` as a general fix, only for declarations that aren't public API.
