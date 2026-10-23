---
'svelte-docinfo': minor
---

feat: read JSDoc `@template` generics and JSDoc-annotated types like their TS twins

In JS files:

- `@template` tags fill `genericParams` on functions, arrow functions and function expressions (`/** @template T @param {T} a */ export const fn = (a) => a`), classes, and class methods, with constraints (`@template {string} K`) and defaults (`@template [K='k']`), as `<T, K extends string = 'k'>` does. A `@type {<T>(a: T) => T}` on a const reads its generics the same way.
- A `@type`, `@param`, `@property`, or `@returns` type is now the written annotation at its site, as `a: T` is in TS: `typeInfo` and `returnTypeInfo` recover the name of an alias TypeScript dropped (`@param {Lost} x` → `{kind: 'reference', name: 'Lost'}`), and union members take their written order (`/** @type {'b' | 'a'} */`). This covers variables, parameters (`{T=}` and `[b]` included), returns, class fields, getters and setters, and a JS component's typedef props.

In TS and JS files alike, class methods now carry `genericParams` (`fn<U>(a: U): U`), as interface methods and callable type-alias members already did; an overloaded method takes its first overload's.
