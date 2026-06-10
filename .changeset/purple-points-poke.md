---
'svelte-docinfo': minor
---

feat: add `ModuleJson.reExports` — same-name re-export edges published from the
re-exporting module's side (the forward view of `alsoExportedFrom`), with the new
`ReExportJson` schema exported from the barrel.

Breaking:

- `mergeReExports(modules, collectedReExports)` → `mergeReExports(modules)` — edges
  now ride on `ModuleJson.reExports`
- removed `ReExportEntry` (barrel) and `ReExportInfo` (`declaration-build.js`) types;
  `ModuleExportsAnalysis.reExports` entries rename `originalModule` → `module`
  (now `ReExportJson`)
- `analyzeModule` returns `ModuleJson` directly instead of `{module, reExports}`
  (`ModuleAnalyzeResult` removed)
- star-projected value symbols are no longer materialized as declarations in the
  projecting module, and star-projected re-export bindings no longer contribute
  `alsoExportedFrom` back-links — `starExports` is their sole encoding (this also
  removes the spurious `duplicate_declaration` diagnostics star exports used to
  produce). Star-projected namespace bindings still produce links
