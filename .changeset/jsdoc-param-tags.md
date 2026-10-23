---
'svelte-docinfo': minor
---

feat: read JSDoc `@param` optionality, bracket defaults, and nested `{object}` property docs

A parameter is now `optional` whenever a caller may omit the argument, by the checker's `isOptionalParameter`, in TS and JS alike. `type` and `typeInfo` drop the optional-widening `undefined` as they already did for `b?: T`.

- A TS parameter with an initializer (`b = 0`) now carries `optional: true`, unless a required parameter follows it. Exported snippets with a default (`{#snippet s(a, b = 0)}`) follow, so their synthesized `typeSignature` reads `b?: number`.
- Such a parameter's `type` and `typeInfo` drop a top-level `undefined` its type already held (`b: number | undefined = 0`, or one inferred from the initializer) → `number`, as `b?: number | undefined` already did. A literal `undefined`-only type is kept.
- JS `@param {T} [b]`, `@param {T=} b`, and `@param {T} [b=0]` are `optional`, with `type` no longer ending in `| undefined`.
- A bracketed default (`@param {number} [b=0]`) fills `defaultValue` when the parameter has no initializer, verbatim with quotes kept. An initializer wins, and a bracket on a parameter a caller can't omit (a TS `b: number`) is ignored.
- Property tags under a braced `@param {object} opts` (or `{Object}`, `{object[]}`), which TypeScript nests inside the parent tag, now reach `propertyDescriptions`, in `.ts` files too. An array element's `@param arr[].name` keys as `[].name`, and no longer warns `unknown_param`.
