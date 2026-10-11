---
'svelte-docinfo': minor
---

feat: analyze without a tsconfig, choose one, and narrow the program's roots

`tsconfig`, `compilerOptions`, and a new `rootFileNames` are accepted by `analyze()`, `analyzeFromFiles()`, and the Vite plugin, where before only `createAnalysisSession` took the first two. The CLI gains `--tsconfig <path>` and `--no-tsconfig`.

- `tsconfig: false` analyzes a project that has no `tsconfig.json`. The compiler options are `DEFAULT_COMPILER_OPTIONS`, exported from `svelte-docinfo/typescript-program.js` (strict, bundler resolution, `allowJs` and `checkJs`) with your `compilerOptions` merged on top. It's opt-in: a missing config still throws otherwise.
- `rootFileNames` replaces the program's root files, which default to everything the tsconfig includes. Pass a list, or a function that filters the tsconfig's roots. Analyzing a few files of a large project no longer has to load all of it. Files you analyze and everything they import are always loaded. The one thing narrowing can change is an ambient type (`declare global`, a module augmentation) declared in a file nothing imports: drop that root and the type resolves to `any`. `(roots) => roots.filter((file) => file.endsWith('.d.ts'))` keeps the usual home of those.

Defaults are unchanged, so existing output is too.
