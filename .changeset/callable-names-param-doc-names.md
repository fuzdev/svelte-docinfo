---
'svelte-docinfo': minor
---

feat: a callable property written with a named function type (`handler: Handler`) carries `typeInfo`, a reference to that name, beside the `parameters` and `returnType` its signature expands; methods and inline function types carry none.

feat: `ParameterJson.docName` carries the name a destructured parameter's `@param` tag gives it (`options` for `fn({a, b}: T)` under `@param options`), so a renderer can anchor it by more than the positional `__0`.

feat: `generateImport` takes `{specifier: 'source'}` to name the module's own file (`@pkg/lib/foo.ts`) for a package whose `exports` map source extensions; the default stays the shipped `.js`.

fix: a callable property's destructured parameter (`m: ({a}: O) => void`) takes the property's `@param` tag in its position, where it warned `unknown_param`; `@param [a, b] - x` on an array pattern no longer reads the description `, b] - x`.

fix: a followed `typeof` query names the import it reads through by the name its module exports (`typeof config`, not `typeof local_config`).
