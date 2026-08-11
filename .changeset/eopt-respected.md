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
- Callability classification is unchanged by the flag: the callability
  query strips the optional `undefined` in both modes, so a written
  `fn?: (() => void) | undefined` — the spelling the flag forces when a
  possibly-`undefined` handler is assigned to the property — classifies
  `kind: 'function'` like `fn?: () => void`, keeping
  `parameters`/`returnType` and `@param`/`@returns` routing. At an optional
  position an explicit `undefined` is the same runtime observation as
  absence, already carried by `optional: true`; on a callable member that
  flag is also all that survives of the written `undefined` — the signature
  prints without it. `| null` still demotes to `kind: 'variable'` — `null`
  is a real value absence doesn't imply — as does a *required* property's
  written `undefined` (`fn: (() => void) | undefined`), which has no
  `optional: true` to carry it.
- Optional parameters and tuple elements keep widening under the flag (it
  governs properties only), so their strips stay unconditional. With the
  flag off, output is unchanged. Note the `getNonNullableType` rewrite above
  still applies at those two positions in both modes — `(c?: E | F)` reports
  `"NonNullable<E> | NonNullable<F>"` — since the flag can't gate a strip
  that genuinely has widening to remove.
- Breaking for `@internal` subpath callers: `ExtractContext` gains a
  required `exactOptionalPropertyTypes: boolean`, and `analyzeExports` /
  `analyzeTypescriptModule` take the pass's `ExtractContext` in place of
  `(checker, diagnostics, aliasRegistry)` — built by
  `analyzeModule`/`analyzeSvelteModule` via the new `createExtractContext`
  (`typescript-extract-shared.ts`), which owns the fields derived from the
  program and options; direct callers construct their own.
