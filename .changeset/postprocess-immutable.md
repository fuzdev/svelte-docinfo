---
'svelte-docinfo': minor
---

feat: `mergeReExports` and `resolveComponentAliases` return new arrays

Breaking: the postprocess passes no longer mutate their input
`modules` — use the return value:

```ts
const processed = resolveComponentAliases(mergeReExports(modules));
```

Unchanged modules and declarations flow through reference-equal (structural
sharing), so idempotent re-runs return the same objects.
