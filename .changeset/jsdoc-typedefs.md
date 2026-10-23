---
'svelte-docinfo': minor
---

feat: document JSDoc `@typedef`, `@callback`, and `@enum` like their TS twins

In JS files, `@typedef` and `@callback` declarations now read like `type A = …` aliases on every path:

- `docComment` and doc tags, read as TypeScript's hover reads them, except as noted: the tag's own comment (`@typedef {number} A - Description`), plus the JSDoc block's prose and tags (`@deprecated`, `@nodocs`, `@see`, `@since`, `@example`) when the block is a typedef block, one with no `@param` or `@returns`. The declaration below a typedef block no longer takes its prose or tags, so `/** T. @typedef {string} N @nodocs */ export function f() {}` documents `N` as `@nodocs` and `f` without a description. Module and component comments keep their prose, as does a component's in-script JSDoc above `$props()`, the typedef tag dropping. A block with several typedefs leaves each only its own tag comment, and a function doc block (one with a `@param` or `@returns`) stays the function's, leaving its typedef only its own tag comment (hover would show the block's prose on those typedefs too).
- `members`: `@property` tags become members with their descriptions, `optional: true` for `[x]` and `{T=}`; a `@callback` gets a `(call)` member whose parameters carry the `@param` descriptions, optionality, rest, and bracket defaults, with `returnDescription` from `@returns`.
- `typeInfo` on the alias, with union members in written order at the alias and at every use site.
- `genericParams` from the block's `@template` tags, with constraints (`@template {string} T`) and defaults (`@template [T=D]`). `genericParams` constraints from a `@template` tag drop the braces.
- `const A = …` with a same-named `@typedef A` documents the typedef with `mergedValue: true`, falling back to the const's JSDoc, as `const` + `type` does.
- The alias registry and `alias_lost` cover typedefs, and `externalTypes` descends through local typedefs (a JS component's `@typedef {HTMLButtonAttributes & {…}} Props`).
- Typedefs in a JS `<script module>` carry original-source `sourceLine`s (they read one line off before).
- A `@typedef` in a JS component's HTML `@component` comment, which svelte2tsx copies into its generated code, no longer documents a type (it carried a `sourceLine` past the end of the file), names one at use sites, or warns `alias_lost`.

An `@enum {T}` const (`export const A = {a: 'a'}`) is now `kind: 'enum'` (was `kind: 'type'`), with `typeSignature` the tag's type `T` and a member per property the project declares (a string or array initializer lists none of its library members).

TypeScript binds none of these tags in `.ts` files, but a `.ts` declaration below a typedef block (a `@typedef` or `@callback` with no `@param` or `@returns`) now loses that block's prose and tags, as its hover does.
