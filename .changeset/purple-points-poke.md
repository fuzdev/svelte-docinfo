---
'svelte-docinfo': minor
---

feat: add `ModuleJson.reExports` — same-name re-export edges published from the
re-exporting module's side (the forward view of `alsoExportedFrom`), with the new
`ReExportJson` schema exported from the barrel. Edges carry `typeOnly` (statement-
or specifier-level type-only re-exports) and `sourceLine` (the specifier's line,
remapped to the original source for Svelte `<script module>`).

feat: add `ModuleJson.externalReExports` (`ExternalReExportJson` — `{name,
specifier, originalName?, typeOnly, sourceLine}`) and
`ModuleJson.externalStarExports` for re-export statements that directly reference
an external package (`export {x} from 'pkg'`, `export * as ns from 'pkg'`,
`export * from 'pkg'`). Import-then-export and chains through a source module
stay silent.

feat: synthesized alias declarations now carry `sourceLine` pointing at the local
export specifier (previously `undefined`); namespace originations in Svelte
`<script module>` blocks get remapped lines too.

feat: add `resolveExportSurface(modules, path)` — resolves a module's full
export surface (own declarations, re-export edges, externals, and
transitively-projected stars) with ES semantics: explicit exports shadow
star-projected names, names ambiguous between stars are excluded, `default`
never projects. Returns name-sorted entries with provenance plus
`unresolvedStarExports`/`externalStarExports` incompleteness reporting.
Exported from the barrel with `ExportSurface`/`ExportSurfaceEntry` types.

Breaking:

- `mergeReExports(modules, collectedReExports)` → `mergeReExports(modules)` — edges
  now ride on `ModuleJson.reExports`
- removed `ReExportEntry` (barrel) and `ReExportInfo` (`declaration-build.js`) types;
  `ModuleExportsAnalysis.reExports` entries rename `originalModule` → `module`
  (now `ReExportJson`)
- `analyzeModule` returns `ModuleJson` directly instead of `{module, reExports}`
  (`ModuleAnalyzeResult` removed)
- star projection is no longer materialized in the projecting module — value
  symbols, projected re-export specifiers, and namespace bindings alike produce
  no declarations, no `reExports` edges, and no `alsoExportedFrom` back-links;
  `starExports` is the sole encoding (this also removes the spurious
  `duplicate_declaration` diagnostics star exports used to produce)
- `findDuplicates` compares by canonical identity (resolving `aliasOf` chains),
  so an alias and its canonical no longer flag `duplicate_declaration` — fixes
  false positives on documented same-name re-exports (Position-3 synthesis) and
  `export {default as Foo} from './Foo.svelte'`
- statement-level `@nodocs` now suppresses `starExports` entries, consistent
  with the other re-export encodings
