---
'svelte-docinfo': minor
---

feat: publish re-exports from the re-exporting module's side —
`ModuleJson.reExports` (`ReExportJson` — `{name, module, typeOnly, sourceLine}`,
the forward view of `alsoExportedFrom`), plus `ModuleJson.externalReExports`
(`ExternalReExportJson`) and `externalStarExports` for statements directly
referencing an external package. Import-then-export and chains through a source
module stay silent.

feat: add `resolveExportSurface(modules, path)` — combines declarations,
re-export edges, externals, and transitively-resolved stars into one name-sorted
surface with provenance, applying ES star semantics (explicit beats star, names
ambiguous between stars excluded, `default` never projects) and reporting
`unresolvedStarExports`/`externalStarExports` instead of guessing.

feat: synthesized alias declarations now carry `sourceLine` pointing at the
local export specifier (previously `undefined`); Svelte `<script module>` lines
are remapped to the original source.

Breaking:

- `mergeReExports(modules, collectedReExports)` → `mergeReExports(modules)`;
  `analyzeModule` returns `ModuleJson` directly (`ModuleAnalyzeResult` removed);
  removed `ReExportEntry`/`ReExportInfo` types (`ModuleExportsAnalysis.reExports`
  entries rename `originalModule` → `module`, now `ReExportJson`)
- star projection is no longer materialized in the projecting module — value
  symbols, projected specifiers, and namespace bindings alike produce no
  declarations, edges, or back-links; `starExports` is the sole encoding (this
  also removes the spurious `duplicate_declaration` diagnostics star exports
  used to produce)
- `findDuplicates` compares by canonical identity (resolving `aliasOf` chains),
  so an alias and its canonical no longer flag — fixes false positives on
  documented same-name re-exports and `export {default as Foo} from './Foo.svelte'`
- statement-level `@nodocs` now suppresses `starExports` entries, consistent
  with the other re-export encodings
