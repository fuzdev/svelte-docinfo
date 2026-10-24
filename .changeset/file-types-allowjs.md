---
'svelte-docinfo': minor
---

feat: analyze `.mts`, `.tsx`, `.mjs`, and `.jsx` modules, and JS without `allowJs`

**Breaking:**

- The default `exclude` is `['**/*.{test,spec}.{ts,mts,tsx,js,mjs,jsx}', '**/internal/**']`, so test and spec files of every module extension stay out; `.ts` ones are excluded as before.
- `allowJs` is always on for the analysis program (below), which changes output for a TS project that imports JS: a relative import of a `.js` file with no declaration file beside it used to type as `any`, and now reads the file's inferred types. A self-name import (`import … from 'own-pkg/x'`) whose `exports` entry lists an `import`/`default` JS target before `types` now resolves to the `.js` file, not the `types` file a `tsc` without `allowJs` picks; list `types` first.

Changes:

- `.mts`, `.tsx`, `.mjs`, and `.jsx` files are modules like `.ts` and `.js` (`isTypescript`, `getDefaultAnalyzer`, the derived glob patterns). Exports discovery maps a `dist` `.js` entry to a `.ts` source, then `.tsx`, `.js`, `.jsx`, and a `.mjs` entry to `.mts`, then `.mjs`; a wildcard entry matches the same extensions. `generateImport` names the shipped file (`.ts`/`.tsx`/`.jsx` → `.js`, `.mts` → `.mjs`). `.cjs` and `.cts` stay out.
- The analysis program always runs with `allowJs` on, whatever the tsconfig says (`checkJs` stays as configured); `AnalysisLanguageService.getCompilerOptions()` returns the forced options. Under a tsconfig without `allowJs`, `.js` modules used to be skipped with `module_skipped` and every TS import of them typed `any`; they now document, and their importers' types resolve, including JS that only an import reaches. The tsconfig's `include` adds no `.js` roots, and untyped packages stay `any`.
- New `commonjs_unsupported` warning: a JS module TypeScript doesn't bind as a module (no ES syntax under `bundler`/`esnext`) that exports through `module.exports`/`exports.x` still emits an empty module, now with a warning saying why. Under `node16`/`nodenext` or `moduleDetection: 'force'` the checker's own CommonJS reading documents its named exports (`exports.x`, `module.exports = {a, b}`), with no warning; a `module.exports =` of a function or literal documents nothing.
- `lexImports` takes an optional path, parsing `.tsx`/`.jsx` content as TSX so imports inside JSX markup are found.
- Fix: a module dropped with `module_skipped` no longer leaves other modules' `dependencies`/`dependents` naming it.
