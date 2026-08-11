---
'svelte-docinfo': minor
---

feat: resolve dependency edges for in-memory files; add `ImportResolver.invalidate()`

`ModuleJson.dependencies` / `dependents` silently omitted edges whenever the
target's content lived only in memory — a build tool handing over transformed
source, an unsaved editor buffer, any `analyze()` input with no disk
counterpart. The session served that content to the checker, so types resolved
and nothing warned; only the graph was wrong. Three causes, each fixed:

- **The default resolver ran against `ts.sys`.** It now resolves through a
  host that answers from the session's owned set plus the in-flight batch
  (dependency resolution runs before a batch commits, so a batch must resolve
  against itself), and the `.svelte` fallback — which TypeScript can never
  resolve on its own — probes the same host, so in-memory components find each
  other. `createDefaultResolver` takes that host as an optional third argument;
  it defaults to `ts.sys`, so disk-only callers are unaffected.
- **Directory probes answered from disk.** TypeScript asks whether a directory
  exists before trying any file inside it, and treats "no" as "every candidate
  in here failed" without ever calling `fileExists` — so a file in a directory
  the disk doesn't have was unresolvable for the *checker* too, its imports
  typed as errors with no diagnostic. Both the one-shot and language-service
  hosts now answer from the files they serve as well as the disk.
- **A specifier that resolved to nothing stayed that way.** The resolver's
  cache stores failed lookups and lived as long as the session, and the
  session's own entry cache is keyed on content — so creating a file that an
  existing module already imports left the edge missing until the importer
  itself was next edited, which is the wrong trigger: the file that changed is
  the dep. That is the shape every watcher-driven consumer has. Resolver caches
  are now dropped when the owned set gains or loses a path, and a `setFiles`
  that adds paths retries the unresolved specifiers of already-owned entries,
  updating their edges and retiring any `resolver_failed` that has since
  resolved. Files whose imports all resolved cost nothing, and pre-resolved
  callers are untouched — their edges are theirs to declare.

`ImportResolver` gains an optional `invalidate()` for the first of those:
implement it if your resolver caches failed lookups, and the session will call
it when its file set changes shape. Resolvers that don't cache need nothing.
