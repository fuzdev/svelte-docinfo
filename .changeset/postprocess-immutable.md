---
'svelte-docinfo': minor
---

feat: `mergeReExports` and `resolveComponentAliases` return new arrays

Breaking: the two phase-2 postprocess passes no longer mutate their input
`modules` — each returns a new `Array<ModuleJson>`, copying only the modules
and declarations that actually change (everything untouched flows through
reference-equal, so a re-run over already-merged output returns the same
objects). Callers relying on in-place mutation must use the return value:

```ts
const processed = resolveComponentAliases(mergeReExports(modules));
```

With this, no `ModuleJson[]` pipeline function mutates its input —
`findDuplicates`, `sortModules`, and `computeDependents` already returned
new values.
