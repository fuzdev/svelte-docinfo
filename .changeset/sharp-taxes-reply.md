---
'svelte-docinfo': patch
---

fix: correct optional type signatures

- `a?: string | null` reported `"string"`
- `a?: null` reported `"never"`, and so did `a?: undefined`
- `b?: number` reported `"number | undefined"` as a parameter type
- `fn?(a: string): number` shipped with no `typeSignature`, `parameters`, or
  `returnType` under `strictNullChecks`, and `fn?: () => void` and
  `fn?: (() => void) | (() => number)` were demoted from `kind: "function"`
  to `"variable"`
- component props typed `Snippet<[...]> | null` without `?` lost their
  snippet `parameters`
- optional snippet tuple elements (`Snippet<[a?: string]>`) reported
  `"string | undefined"` alongside `optional: true`, and synthesized snippet
  `typeSignature`s omitted the `?` marker (`Snippet<[a: string]>` for a
  snippet declared `{#snippet greet(a?: string)}`)

A callable's `typeSignature` still renders the checker's widening
(`"(b?: number | undefined): void"`) — it comes from `signatureToString`, which
has no flag to omit it.
