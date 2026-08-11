---
'svelte-docinfo': minor
---

feat: the `src/lib/internal/` convention — default `**/internal/**` exclude, exclude-callback overrides, and null-exports blocking

Internal modules ship in a package for public modules to import but aren't
part of the public surface. Three coordinated changes support the convention
(gro's exports generation emits the matching `"./internal/*": null` blocker):

- `DEFAULT_SOURCE_OPTIONS.exclude` gains `'**/internal/**'` — `internal/`
  directories are excluded from discovery and analysis by default. Breaking
  for projects documenting an `internal/` directory: re-include it with the
  new callback form
  (`exclude: (defaults) => defaults.filter((p) => p !== '**/internal/**')`).
- The exclude override surfaces (`createSourceOptions` overrides,
  `analyzeFromFiles`'s `exclude`/`sourceOptions`, the Vite plugin) accept
  `ExcludeOption`: an array replaces the defaults wholesale (unchanged), a
  `(defaults) => patterns` callback extends them without restating them —
  closing the footgun where any custom `exclude` silently dropped the test
  filters. New exported types `ExcludeOption` and `SourceOptionsOverrides`;
  option types previously written as `Partial<SourceOptionsDefaults>` now use
  `SourceOptionsOverrides`. The CLI's `--exclude` stays array-only.
- Exports-based discovery honors null-target exports keys with Node's
  resolution semantics (exact-key-wins, then `PATTERN_KEY_COMPARE`
  best-match). Previously null entries were skipped and the generic wildcards
  leaked the "blocked" files into discovery; now a subpath whose
  most-specific matching key resolves nothing — a literal `null`, or any
  object-ish value with no usable target (all-null/empty conditions object,
  fallback array with no usable element) — is never discovered, a more
  specific positive key still beats a broader null key, and concrete
  positive entries are never blocked. `ParsedExports` gains a `blocked`
  array, interpreted by the newly exported `createBlockedSpecifierChecker`
  (a naive membership check is wrong for wildcard keys).

Plus the follow-through that keeps the convention live end-to-end:

- **Sessions own the context closure** — new
  `AnalysisSessionOptions.contextClosure` (default `true`; `analyze()` opts
  out, `analyzeFromFiles` and the CLI keep it on): after each ingest batch
  the session reads from disk the in-root non-source files the batch's
  imports resolved to (transitively; `node_modules`/dot-dir segments and
  analyzer-less files excluded) and owns them as version-tracked context
  files. Output is
  unchanged — `query()` still gates them — but their edits now propagate: the
  Vite plugin's watcher gate widened to `isSource(file) || session.has(file)`,
  so editing an `internal/` module re-analyzes the public modules that use it
  instead of serving stale types until a dev-server restart.
- **Stale-AST fix** — the first `setFile` of a file the session had
  previously resolved from disk was a silent no-op (a version collision in
  the language-service host), serving the stale AST despite new content.
- **Re-exports from gated modules synthesize instead of misclassifying** —
  re-export classification now splits externality (`createIsExternalPath`,
  newly exported from `svelte-docinfo/typescript-program.js`) from the source
  gate. Previously `export { x } from './internal/helper.js'` landed in
  `externalReExports` with a relative path as its "package" specifier and the
  public name vanished from docs; now the re-exporting module synthesizes a
  full alias declaration (same-name, renamed, and import-then-export forms —
  including a same-name chain through a gated rename hop over a source
  canonical; namespace re-exports classify as namespaces; star exports from
  gated modules land in `starExports` and surface as
  `unresolvedStarExports`).
  `aliasOf` is kept for provenance and duplicate dedupe; its `module` may
  reference a module absent from output — a documented margin. Gated Svelte
  component re-exports document with full props: gated Svelte virtuals are
  analyzed as canonical-fill context at query time (`resolveComponentAliases`
  gains an optional lookup-only `contextModules` argument), so the filled
  alias tracks internal component edits live under the Vite plugin.
- **Fallback-array exports values parse** — `parsePackageExports` takes the
  first usable element of an array target, so array-valued keys are real
  positive entries: discovered directly, and never out-matched by a broader
  null wildcard (previously they were skipped entirely, and under blocking
  they failed closed against the fail-open intent).
- `getDefaultAnalyzer` is exported from the main barrel so custom
  `getAnalyzerType` implementations extend the default table by delegation
  instead of restating it.
