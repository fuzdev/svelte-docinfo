---
'svelte-docinfo': minor
---

feat: merged value+type symbols document the type meaning, marked `mergedValue`

- A merged value+type export (`const Foo = z.strictObject({...})` +
  `type Foo = z.infer<typeof Foo>`, the schema/type pattern; `const X` +
  `interface X` likewise) now documents the type meaning — structure,
  `members`, `typeInfo`, like the un-merged equivalent — instead of the
  value's type under the type's kind (previously a `ZodObject<...>` husk
  with zero members). JSDoc reads the type declaration first and falls back
  to the const's docs; `@nodocs` on either declaration suppresses;
  `sourceLine` points at the type declaration.
- `TypeDeclarationJson`/`InterfaceDeclarationJson` gain `mergedValue`
  (default `false`, stripped on the wire): the exported name is also
  importable as a runtime value.
- `generateImport` emits a plain `import` for merged declarations instead of
  `import type`, which broke value use (`Foo.parse(...)`) when copy-pasted.
