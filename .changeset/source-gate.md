---
'svelte-docinfo': minor
---

feat: gate the module set through `isSource` at query time, and harden the source scope

Output previously trusted its input wholesale: any file handed to `analyze()`
or a session became a `ModuleJson` — excluded test files, out-of-root files
with absolute paths, even a root `tsconfig.json`. Now `session.query()`
filters the emitted module set through `isSource`. Ingest stays ungated on
purpose: non-source files still feed the checker as in-memory context;
`session.list()` reports the full owned set and `query()` logs the gated
count as info.

Scope changes landing with the gate:

- **Include patterns widen the source scope.** Each explicit `include`
  pattern's static base joins `sourcePaths`, so include-discovered files pass
  the gate, get module paths relative to the widened set's common root
  (`--include 'src/**'` now yields `lib/a.ts`, not `a.ts`), and get
  dependency edges. The Vite plugin widens identically, which also fixes its
  watcher for those files. A pattern with no base (`'**/*.ts'`, a literal
  root file) scopes the whole project root and logs an info line naming it.
- **Always-on baseline exclusions.** `node_modules` and dot-directories below
  a source path are never source — applied by `isSource` (gate, watcher,
  dependency edges) and as anchored glob ignores at discovery. Matched
  relative to the matched source path, so an explicit dot-dir source path
  (`['.hidden/src']`) still works; `dist`/`build`/`coverage` stay in.
  Independent of `exclude`, which replaces defaults wholesale.
- **Out-of-root config throws.** A `sourcePaths` entry, `sourceRoot`, or
  widened include base resolving outside `projectRoot` now throws at options
  creation instead of silently emitting nothing. Absolute entries are
  accepted when they resolve inside `projectRoot` (stored root-relative);
  a root-anchored `'/src/lib'` is no longer shorthand for `'src/lib'` — the
  error hints to drop the slash. In-root `.`/`..` segments normalize away
  (`src/../lib` → `lib`, `.` → `''`).
- **Exclude and glob fixes.** Concrete package.json export entries now
  respect `exclude` at discovery (previously only wildcards did), and
  `deriveIncludePatterns` derives a relative root glob for the `''` source
  path — the old `/**` shape globbed from the filesystem root.
