---
'svelte-docinfo': patch
---

fix: recover a lost alias written as one member of a larger union

An alias TypeScript drops (over an indexed access or conditional, like `z.infer<typeof S>`) that is itself a union lost its name in `typeInfo` once other members were written beside it: `a: LostUnion | null` documented as the expanded members plus `null`. The written reference now recovers as one `{kind: 'reference', name: 'LostUnion'}` member at its written position, so `a` reads `LostUnion | null`, wherever the union is written: at the annotated position, nested inside it, or as an alias right-hand side (`type Opt = LostUnion | null`, at every use of `Opt`). The members still expand when they don't all survive as distinct members (`LostUnion | string`, where `string` absorbs string literals), when an earlier written member overlaps it (`'a' | LostUnion`), when a lost union that includes `undefined` sits at an optional position whose `undefined` the optional widening strips (`x?: LostU | 'z'` without `exactOptionalPropertyTypes`, or an optional parameter), and at unannotated positions such as an inferred `cond ? s.out : null`. Flat type strings are unchanged.
