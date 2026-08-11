---
'svelte-docinfo': patch
---

fix: optional class methods keep their signatures under `strictNullChecks`

`m?(): void {}` resolves to `(() => void) | undefined`, which reports no
call signatures — the member shipped as `kind: 'function'` with no
`typeSignature`/`parameters`/`returnType`, and without `optional: true`.
The class-method site now strips the widening before querying signatures,
like the interface-method site, and optional methods carry `optional: true`.
Locked by the `ts/members/class-methods-optional` fixture, the class-side
mirror of `ts/members/interface-methods-optional`.
