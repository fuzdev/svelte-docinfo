---
'svelte-docinfo': minor
---

feat: document JSDoc `@overload` signatures like TS overloads

In JS files, a function, arrow function, class method, or constructor with `@overload` tags documents each overload as TypeScript reads it:

- Each overload's `docComment` is the prose of the block holding its `@overload` tag, and its `@param` and `@returns` tags fill `parameters[i].description` and `returnDescription`. Optional (`[b]`, `{T=}`) and defaulted (`[b=0]`) parameters read as on a function's own `@param` tags, and a rest (`{...T}`) parameter is `rest`, though the checker types it `T | undefined`.
- The first overload documents the function: its prose and tags give the declaration's `docComment` and tag fields, and its `@template` tags its `genericParams`. Each overload carries its own block's `@template` tags as `genericParams`. A symbol-scope tag on a later overload warns `misplaced_tag`.
- The implementation's own JSDoc block is hidden, prose and tags, as TypeScript ignores an implementation signature's JSDoc. A function documented only on its implementation block loses that `docComment`, and an implementation-block `@nodocs` no longer hides the function: move them to the first `@overload` block.
- A JS constructor's `@overload` tags are its public signatures.

In TS, the overload whose symbol-scope tags document the symbol is now told apart by identity, not prose: it is the overload the member's docs come from, so a later overload repeating its prose warns `misplaced_tag`, and when an interface merged ahead of a class lists its method's signatures first, the interface's overload warns rather than the class's. Overloads a member borrows through its type (`m: typeof g`, `@property {typeof g} m`) have no primary, since the member's docs are its own: every overload's symbol-scope tags warn, even when its prose matches the member's.
