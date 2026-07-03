# svelte-docinfo

## 0.5.4

### Patch Changes

- fix: non-root module detection with Node-resolving rules for glob exports ([4570f3e](https://github.com/fuzdev/svelte-docinfo/commit/4570f3e))
- refactor: add `to_error_message` and `error.ts` ([d145381](https://github.com/fuzdev/svelte-docinfo/commit/d145381))

## 0.5.3

### Patch Changes

- fix: `docComment` and `moduleComment` collision ([40bcb7c](https://github.com/fuzdev/svelte-docinfo/commit/40bcb7c))

## 0.5.2

### Patch Changes

- fix: `.svelte` resolution and dedupe `ModuleJson.dependencies` ([c48e203](https://github.com/fuzdev/svelte-docinfo/commit/c48e203))

## 0.5.1

### Patch Changes

- fix: remove errant `@nodocs` on `index.ts` module comment ([3a96842](https://github.com/fuzdev/svelte-docinfo/commit/3a96842))
- fix: improve `@nodocs` handling to warn on module comments ([3a96842](https://github.com/fuzdev/svelte-docinfo/commit/3a96842))

## 0.5.0

### Minor Changes

- feat: publish re-exports from the re-exporting module's side — ([#3](https://github.com/fuzdev/svelte-docinfo/pull/3))
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

## 0.4.1

### Patch Changes

- feat: add `AnalyzeResultJsonWire` for the vite plugin value ([#2](https://github.com/fuzdev/svelte-docinfo/pull/2))

## 0.4.0

### Minor Changes

- chore: fix peer deps ([0e39268](https://github.com/fuzdev/svelte-docinfo/commit/0e39268))

## 0.3.0

### Minor Changes

- fix: improve inferred type output for intersections and unions ([#1](https://github.com/fuzdev/svelte-docinfo/pull/1))

## 0.2.1

### Patch Changes

- fix: use `Object.create(null)` to avoid prototype issues ([7b79be8](https://github.com/fuzdev/svelte-docinfo/commit/7b79be8))

## 0.2.0

### Minor Changes

- feat: capture object-property `@param obj.prop` descriptions ([d52b3d3](https://github.com/fuzdev/svelte-docinfo/commit/d52b3d3))

### Patch Changes

- fix: ignore node builtins ([6848647](https://github.com/fuzdev/svelte-docinfo/commit/6848647))
- fix: accept dotted `@param obj.prop` keys in param validation ([6848647](https://github.com/fuzdev/svelte-docinfo/commit/6848647))

  `@param obj.prop` (documenting a property of an object/destructured parameter)
  no longer emits a spurious `unknown_param` warning when `obj` is a real
  parameter.

- fix: resolve without vite to avoid polluting its detection ([b82e4e4](https://github.com/fuzdev/svelte-docinfo/commit/b82e4e4))

## 0.1.0

### Minor Changes

- init ([7ededbf](https://github.com/fuzdev/svelte-docinfo/commit/7ededbf))
