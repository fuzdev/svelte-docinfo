---
'svelte-docinfo': minor
---

feat: document JSDoc `@overload` signatures like TS overloads

**Breaking:**

- A JS function with `@overload` tags no longer takes its docs from the implementation's own JSDoc block, as TypeScript ignores an implementation signature's JSDoc: a `docComment` written only there is gone, and an implementation-block `@nodocs` no longer hides the function. Move them to the first `@overload` block. The new `implementation_doc_hidden` warning points at each such implementation.
- In TS, a later overload that repeats the first overload's prose now warns `misplaced_tag` for its symbol-scope tags (the primary overload is told apart by identity, not prose).
- Overloads a member borrows through its type (`m: typeof g`, `@property {typeof g} m`) no longer warn `misplaced_tag`: their tags sit where the lender's author put them, and the lender's own analysis checks them.

In JS files, a function, arrow function, class method, or constructor with `@overload` tags documents each overload as TypeScript reads it:

- Each overload's `docComment` is the prose of the block holding its `@overload` tag, and its `@param` and `@returns` tags fill `parameters[i].description` and `returnDescription`. Optional (`[b]`, `{T=}`) and defaulted (`[b=0]`) parameters read as on a function's own `@param` tags, and a rest (`{...T}`) parameter is `rest`, though the checker types it `T | undefined`.
- The first overload documents the function: its prose and tags give the declaration's `docComment` and tag fields, and its `@template` tags its `genericParams`. Each overload carries its own block's `@template` tags as `genericParams`. A symbol-scope tag on a later overload warns `misplaced_tag`.
- A JS constructor's `@overload` tags are its public signatures.

New `implementation_doc_hidden` warning (`functionName`), in TS and JS alike: an overloaded function, method, or constructor whose implementation carries prose or doc tags, which the output hides. A block of types alone (`@param {string} a`) doesn't fire.

When an interface merged ahead of a class lists its method's signatures first, the interface's overload warns `misplaced_tag` rather than the class's.
