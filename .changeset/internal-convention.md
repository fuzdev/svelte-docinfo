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
  most-specific matching key resolves nothing — a literal `null`, or a
  conditions object with no usable target — is never discovered, a more
  specific positive key still beats a broader null key, and concrete
  positive entries are never blocked. `ParsedExports` gains a `blocked`
  array, interpreted by the newly exported `createBlockedSpecifierChecker`
  (a naive membership check is wrong for wildcard keys).
