---
'svelte-docinfo': minor
---

feat: document the props of legacy `export let` components

A component that declares its props with `export let` instead of `$props()` now has them in `props`, with types, optionality, defaults, JSDoc, and callback or snippet signatures like any other component. Before, it had none.

A default slot now sets `acceptsChildren` on a legacy component, with or without props: a `<slot />` in the template or a declared `$$Slots`. A named slot alone doesn't, and a runes component's `<slot />` is ignored, so it still needs a `children` snippet prop or `{@render children()}`. Legacy means what svelte2tsx reads as runes-less: no rune in the script and no `<svelte:options runes />`, template-only components included.

**Breaking:** the `legacy_props` diagnostic kind is removed, along with its `LegacyPropsDiagnostic` schema and type. If you match on that kind, drop the branch; there's no replacement, since the props are extracted now.

Details:

- Every legacy prop has `bindable: true`, since any `export let` can be bound.
- `defaultValue` is the initializer as written, including for the `let a = 1; export {a as b}` rename form.
- A TypeScript component's reserved `$$Props` type is honored: props it declares without an `export let` are included, and properties from an external type like `HTMLButtonAttributes` are summarized in `externalTypes`, except the ones the script exports.
- A JavaScript component takes each prop's type from the JSDoc `@type` on its `export let`, and a prop is optional when it has an initializer.
- An `export let` name that `$$Props` doesn't declare isn't a prop, since a typed consumer can't pass it.
- Accessors (`export const`, `export function`, `export class`) aren't props.
- Named slots, slot props, and events aren't modeled.
- Props are listed in the order the script exports them.
- If the svelte2tsx output has no props type the analyzer recognizes, the component has no props and each exported one gets a `svelte_prop_failed` warning.
