# schema-library benchmarks

Scripts that compare svelte-docinfo builds that differ in their schema library
(zod, valibot, or none on the analysis path). Every script takes built trees as
`name=/path` arguments, so the same commands measure any set of checkouts.

A _tree_ is a checkout with `dist/` built and its own `node_modules`. Build one
from any checkout or worktree, uncommitted edits included:

```bash
bench/schema-lib/prepare-tree.sh /path/to/checkout ~/.cache/docinfo-bench/trees/main
```

`prepare-tree.sh` works on a tar copy (no `.git`, no `node_modules`), so the
build never touches the checkout, and it restores the global `svelte-docinfo`
npm link that `gro build` re-points, to wherever it pointed before the build
(`SVELTE_DOCINFO_LINK` overrides the restored target).

| script | measures |
| --- | --- |
| `footprint.sh <work> name=tree…` | installed size of the packed tarball plus its production dependency closure, per package |
| `bundle.mjs --esbuild <pkg-dir> --tree name=tree…` | esbuild bundle (minified, gzip, brotli) of minimal consumers, and the schema library's share |
| `runtime.mjs --tree name=tree[:option=json]… --corpus name=root…` | `analyzeFromFiles` end to end, the validation boundary alone, the wire round trip, and an output hash per tree and corpus |
| `typecheck.sh <runs> name=tree…` | `gro typecheck` and `tsc` wall time, `tsc --extendedDiagnostics` counters, emitted declaration sizes |
| `consumer-typecheck.sh <work> <runs> <consumer> name=tree…` | a consumer repo typechecked against each tree, without publishing |
| `errors.mjs name=tree…` | messages and issue paths for the same malformed inputs |

Notes on reading the numbers:

- `runtime.mjs` runs each (tree, corpus, run) in a fresh process, interleaved,
  and reports median with min and max. Identical `hashes` across trees for a
  corpus means byte-identical `JSON.stringify` output; `--out <dir>` also writes
  each result for `cmp`.
- `parseModules` re-parses every module from its compact (defaults-absent) form,
  the closest stand-in for the builder objects the analyzer validates, so
  `parseModules / analyze` approximates validation's share of a run.
- `bundle.mjs` keeps `typescript`, `svelte`, `svelte2tsx`, and `vite` external.
  The schema library's share is the difference from the same bundle built with
  the library external.
- A tree option such as `name=/path:validate=true` is passed to `analyzeFromFiles`,
  for a tree whose build has that option.
