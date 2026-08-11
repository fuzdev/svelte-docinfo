---
'svelte-docinfo': minor
---

fix: respect `exactOptionalPropertyTypes` — stop stripping author-written `undefined` from optional properties

- Under the flag the checker never widens optional properties, so every
  `undefined` there is author-written — extraction now reads the flag off
  the program and skips the optional-widening strip at property sites
  (component props, type-alias/interface/class properties), flat strings
  and `typeInfo` trees together. Previously `x?: T | undefined` shipped as
  `"T"`, `x?: T | null | undefined` as `"T | null"`, and `tp?: E | F` was
  corrupted to `"(E & {}) | (F & {})"` by the strip's `getNonNullableType`
  fallback.
- Callability follows the declared type: a written
  `fn?: (() => void) | undefined` demotes to `kind: 'variable'` with the
  union kept — declared `undefined` poisons callability like `| null` —
  while `fn?: () => void` and unions of callables still classify
  `'function'`.
- Optional parameters and tuple elements keep widening under the flag (it
  governs properties only), so their strips stay unconditional. With the
  flag off, output is unchanged.
- Breaking for `@internal` subpath callers: `ExtractContext` gains a
  required `exactOptionalPropertyTypes: boolean`, and `analyzeExports` /
  `analyzeTypescriptModule` take the pass's `ExtractContext` in place of
  `(checker, diagnostics, aliasRegistry)` — constructed from the program by
  `analyzeModule`/`analyzeSvelteModule`; direct callers construct their own.
