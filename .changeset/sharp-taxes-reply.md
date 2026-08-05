---
'svelte-docinfo': patch
---

fix: correct optional type signatures

- `a?: string | null` reported `"string"`
- `a?: null` reported `"never"`
- `b?: number` reported `"number | undefined"` as a parameter type
- `fn?(a: string): number` shipped with no `typeSignature`, `parameters`, or
  `returnType` under `strictNullChecks`, and `fn?: () => void` was demoted from
  `kind: "function"` to `"variable"`

A callable's `typeSignature` still renders the checker's widening
(`"(b?: number | undefined): void"`) — it comes from `signatureToString`, which
has no flag to omit it.
