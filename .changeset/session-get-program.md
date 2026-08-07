---
'svelte-docinfo': minor
---

feat: expose `getProgram()` on `AnalysisSession`

Incremental consumers doing their own checker work over analyzed
declarations (e.g., a docgen provider converting `ts.Type`s into its own
structured model) can now reach the LS-backed `ts.Program` directly instead
of building a second program. Freshness caveat documented on the method: it
returns whatever the most recent ingest produced — reference-stable while no
file version bumps, fresh (with unchanged ASTs reused) after one — so
retained references go stale after any `setFile`/`setFiles`/`deleteFile`.
