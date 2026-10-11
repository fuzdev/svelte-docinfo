---
'svelte-docinfo': minor
---

feat: add `internalMessage` and `mutates` to component props

`@internal` and `@mutates` in a component prop's JSDoc were dropped. `ComponentPropJson` now carries both, with the same shapes as on declarations and members: `internalMessage` is the tag's trailing prose (an empty string for a bare tag), and `mutates` maps each target to its description. On a prop, `@mutates` declares that the component writes into the object or array it's handed (`@mutates items - appends the selected entry`), the same contract a function declares for a parameter. Additive: output for props without these tags is unchanged.
