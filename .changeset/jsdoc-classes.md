---
'svelte-docinfo': minor
---

feat: document JS classes like their TS twins

**Breaking:**

- `@private` on a JS object-literal property no longer hides it in a type alias over the object, since the checker enforces `@private` in classes only.
- A getter/setter pair with either side private (`private set`, or a JS `@private` setter) is dropped whole on the class, as on a type alias over it, in TS and JS alike.

In JS files, a class's JSDoc reads as TypeScript's checker reads it:

- `@private` hides a member, as `private` does, on the class and on any type alias over it; `@protected`, `@public`, and `@readonly` add `modifiers` like the keywords, listed in the order TypeScript requires them written. `@static` and `@abstract` mark nothing, as for the checker.
- `@implements {A}` fills `implements`, and `@extends {Base<T>}` beside an `extends Base` clause makes `extends` `["Base<T>"]`. In a `.ts` file neither tag adds anything.
- `this.x = …` assignments in the constructor, a method, or an accessor declare `variable` members (static ones in a static method or block), typed and modified as the checker reads them, and documented by the first documented constructor assignment, else the first documented one anywhere. They slot in just ahead of the constructor, where a TS twin declares its fields. A name the class writes as a field is listed once, by the field. A name a base class already has stays the base's (`this.name = …` in an `Error` subclass lists nothing), whatever JSDoc the assignment carries, as a TS twin that assigns it without redeclaring; to document it on the subclass, write a field.
- `@readonly` on a JS object-literal property shows `readonly` in a type alias over it (`@typedef {typeof o} T`), as the checker reads it.
