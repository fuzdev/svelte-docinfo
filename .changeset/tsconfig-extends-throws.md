---
'svelte-docinfo': minor
---

**breaking:** `loadTsconfig` (and so `analyze`, `analyzeFromFiles`, `createAnalysisSession`, the Vite plugin, and the CLI) throws when the tsconfig or a config in its `extends` chain fails to load, instead of analyzing with the inherited options silently dropped

A missing `extends` target, like SvelteKit's generated `$app/tsconfig` (or `.svelte-kit/tsconfig.json` before SvelteKit 3) before `svelte-kit sync` has run, previously left out its `lib`, `types`, and `rootDirs`, so external types came out as `any`. The error names the tsconfig and the missing target, and a missing SvelteKit-generated target adds a hint to run `svelte-kit sync`. A tsconfig that fails to parse now throws too. Unknown or invalid compiler options and an `include` that matches no files still don't throw.

The tsconfig's relative paths (`extends`, `include`, path-valued options) now resolve against the config file's own directory, as `tsc -p` does, instead of `projectRoot`. This matters when the config is found in a parent directory (the CLI run from a subdirectory, or the Vite plugin with a nested `root`) or the `tsconfig` option names a file in a subdirectory. Such a config's `include` now adds its files to the analysis program: global and ambient declarations there resolve where they were `any` before, and the program can be larger. Only files under `projectRoot`'s source paths are still documented.
