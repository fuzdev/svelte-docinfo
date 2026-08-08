---
'svelte-docinfo': minor
---

feat: gate the module set through `isSource` at query time

Analysis output previously trusted its input wholesale: any file handed to
`analyze()` or a session became a `ModuleJson` — files matching `exclude`
(the default `**/*.test.ts` included), files outside `sourcePaths`, even a
root `tsconfig.json` — with absolute paths for anything `extractPath`
couldn't relativize, spurious `duplicate_declaration` collisions against
real source declarations, and no dependency edges pointing at them (edges
were already `isSource`-filtered, so the output referenced modules it
half-acknowledged). Now `session.query()` filters the emitted module set
through `isSource`, the same gate `exclude` was always documented to apply
at analysis time.

Ingest stays ungated on purpose — owned entries are served to the checker
from memory before the disk fallback, so pushing non-source files (unsaved
buffers, virtual-only helpers) still shapes type resolution in the modules
that import them; they just don't emit modules. `session.list()` reports the
full owned set. The gate emits no diagnostics (context files are a supported
use, not a problem) — but `query()` logs the gated count as info, so a
misconfigured `sourcePaths` yielding a thinner result leaves a trace.

Two companion fixes keep the surrounding workflows coherent:

- **Explicit `include` patterns widen the source scope.** Discovery `include`
  globs can reach outside `sourcePaths` (`--include 'src/other/**'` under the
  default `['src/lib']`); those files used to emit modules with absolute
  paths and no dependency edges. Each pattern's static base now joins
  `sourcePaths` (new `widenSourcePathsForInclude` in `source-config.js`), so
  include-discovered files pass the gate, get paths relative to the widened
  set's common root, and get edges. This changes module paths for
  broader-than-sourcePaths includes: `--include 'src/**'` now yields
  `lib/a.ts` (relative to `src`), not `a.ts`. An explicit `sourceRoot` that
  doesn't prefix a widened base fails validation loudly instead of emitting
  absolute paths. The Vite plugin applies the same widening, which also fixes
  its watcher ignoring changes to include-discovered files outside
  `sourcePaths`. An empty base from a root-crossing pattern (`'**/*.ts'`)
  scopes the whole project root; `isSource` now treats a `''` source path
  accordingly.
- **Concrete package.json export entries respect `exclude` at discovery.**
  Wildcard exports applied `exclude` via the glob's `ignore`, but a concrete
  entry (a root `.` export mapping to `src/lib/index.ts`) bypassed it —
  visible as `exclude: ['**/index.ts']` having no effect on exports-discovered
  projects. `discoverFromExports` now applies the exclusion to concrete
  entries too, so direct `discoverSourceFiles` consumers (which don't get the
  query gate) see the documented behavior.
