---
'svelte-docinfo': patch
---

fix: `Diagnostic.file` honors its project-root-relative contract; the Vite plugin stops publishing absolute paths

- **Six kinds were relative to `sourceRoot`, not the project root** —
  `duplicate_declaration`, `module_skipped`, `legacy_props`,
  `duplicate_comment`, `svelte_prop_failed`, and `misplaced_tag` from a Svelte
  module comment. `sourceRoot` defaults to `src/lib`, so this was the default
  behavior rather than an edge case: one analysis reported the same file as
  both `Widget.svelte` and `src/lib/Widget.svelte`, grouping by `file` gave two
  buckets for one file, and `formatDiagnostic`'s `./${file}` didn't resolve
  from the project root. The same `misplaced_tag` cause even reported under
  different bases depending on whether the module comment sat in a `.svelte` or
  a `.ts` file. Producers now emit the absolute id and let
  `normalizeDiagnosticPaths` rewrite it — the path every extractor diagnostic
  already took — and the `module_skipped` messages that name a file now name
  the same string `file` does.
- **The Vite plugin published absolute paths** — it never normalized its
  _discovery_ diagnostics, so a `module_unreadable` message, which wraps the fs
  error and therefore embeds the developer's absolute path, reached
  `virtual:svelte-docinfo` verbatim and shipped to any bundle importing it.
  Discovery is the one diagnostic source that can't normalize itself, since it
  runs before a session exists; `analyzeFromFiles` already normalized it before
  merging and the plugin now does the same. Consumers calling
  `discoverSourceFiles` / `discoverFromExports` directly still own that call,
  now stated on the `Diagnostic.file` schema doc.

`Diagnostic.file` names a file, never a module — `ModuleJson.path` is
`sourceRoot`-relative, and `DuplicateDeclarationDiagnostic.modules` still holds
those values, so `file` and `modules` read differently for the same module. A
consumer matching `Diagnostic.file` against `ModuleJson.path`, which those six
kinds accidentally allowed, needs to prefix `sourceRoot` (or read
`duplicate_declaration`'s `modules`, unchanged). Direct `analyzeModule` /
`analyzeSvelteModule` callers still see the absolute form until they run
`finalizeDiagnostics`, as every other diagnostic already reached them.
