---
'svelte-docinfo': minor
---

fix: a destructured parameter takes the `@param` tag in its position, as TypeScript does, so `@param options` documents `fn({a}: Options)` and `@param options.a` fills its `propertyDescriptions`, where both were dropped with a false `unknown_param`
