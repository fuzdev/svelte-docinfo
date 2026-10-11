---
'svelte-docinfo': minor
---

feat: describe callback props with `parameters` and `returnType`

A component prop typed as a function, like `onpick?: (value: string) => void` or a project type alias for one, now carries `returnType` (with `returnTypeInfo` when the flat string isn't the whole story) and `parameters`. `returnType` is what marks a prop as a callback: it's there for a callback with no parameters, where `parameters` stays absent, and never on a snippet prop.

If you render every prop's `parameters` as snippet parameters, check `returnType` first, since callbacks have them now too.

Details:

- `null` and an optional prop's `undefined` are ignored, so `(() => void) | null` is a callback. A union of several function types isn't; `typeInfo` lists its members.
- Only call signatures your project declares count. A prop typed wholly by a package, like `MouseEventHandler<HTMLButtonElement>` or a `Component`, gets neither field.
- When a prop redeclares an attribute from an external type, giving `MouseEventHandler<HTMLElement> & (() => void)`, the fields describe your signature.
- An overloaded callback describes its first signature, and a generic one doesn't record its own type parameters.
- `@param` and `@returns` in the prop's JSDoc aren't read, so the parameters have no descriptions.
