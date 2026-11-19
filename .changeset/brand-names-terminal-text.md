---
'svelte-docinfo': minor
---

feat: a brand reads as its own name. A brand whose type the checker names by a generic's instantiation (`Branded<string, "Uuid">` for `type Uuid = Infer<typeof Uuid>`) recovers `{kind: 'reference', name: 'Uuid', module}` at unannotated positions, by the alias registry, and inside written unions (`x: Uuid | null`). Only the alias named by the brand's own literal registers (another alias of the same brand doesn't take its uses), a brand whose alias is its own (`type H = string & Brand<'H'>`) keeps the checker's name, and a brand's declaration still documents its definition.

fix: terminal `object`, `function`, and `other` text drops the optional widening at every optional property, parameter, and tuple element inside it (`{ a?: string; }` where it read `{ a?: string | undefined; }`), as the tree's own nodes do; under `exactOptionalPropertyTypes` a property's `undefined` stays.

fix: printed `typeof import("…")` text drops the `resolution-mode` import attribute the checker adds (`typeof import("a.ts", { with: { "resolution-mode": "import" } })`).
