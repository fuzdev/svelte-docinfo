---
'svelte-docinfo': patch
---

fix: accept dotted `@param obj.prop` keys in param validation

`@param obj.prop` (documenting a property of an object/destructured parameter)
no longer emits a spurious `unknown_param` warning when `obj` is a real
parameter.
