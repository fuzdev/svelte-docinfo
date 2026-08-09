---
'svelte-docinfo': minor
---

feat: parse the tsconfig once per session; add `getCompilerOptions()` to `AnalysisLanguageService`

The session's lazy default `ImportResolver` re-invoked `loadTsconfig`, so a
cold run with the default resolver parsed the tsconfig twice — duplicating
the `include` glob's directory walk and doubling the "using
.../tsconfig.json" log line. It now reuses the merged options the
`LanguageService` parsed at construction, exposed on the handle as
`getCompilerOptions()` (cheap — no LS sync, unlike
`getProgram().getCompilerOptions()`). The tsconfig is a construction-time
snapshot for the resolver too: after a tsconfig.json edit, create a new
session.
