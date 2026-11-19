---
'svelte-docinfo': minor
---

feat: structured fields for what a signature shows and the output dropped, all additive:

- `returnPredicate` (`{parameterName, asserts, type, typeInfo}`) for a type predicate or assertion, beside a `returnType` that stays `boolean` or `void`
- `thisType` and `thisTypeInfo` for a declared `this` parameter
- `pattern` on a destructured parameter, whose `name` stays `__0`
- `modifiers` on a generic parameter (`const`, `in`, `out`), which `getDisplayName` now writes
- `property: true` on a function member written as a property (`now: () => number`) on an interface or type alias, so it can be told from a method
