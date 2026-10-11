---
'svelte-docinfo': minor
---

feat: document component props the `$props()` destructuring names, even when an external type declares them

Props contributed by an external type, like the attributes in `HTMLInputAttributes`, are left out of `props` and summarized in `externalTypes`. Now a prop the component names in its `$props()` destructuring is documented anyway, since binding it shows the component handles it: in `let {value, type = 'text', disabled, ...rest}: Props = $props()`, `type` and `disabled` appear in `props` with the external declaration's type and JSDoc and the destructuring's default. Renamed elements (`class: className`) document the prop name, nested patterns their top-level name, and the rest element nothing. A name the props type has only through an index signature (`data-${string}`) isn't added. These props follow the others, in destructuring order. `externalTypes` still lists their bags. Components that don't destructure `$props()` are unchanged.

A renamed prop's destructuring default is now read: `class: className = 'a'` gives `class` a `defaultValue` of `'a'`, where before the default was keyed by the local name and lost, for local props too. A nested pattern's default is read the same way: `a: {b} = {b: 1}` gives `a` a `defaultValue` of `{b: 1}`.
