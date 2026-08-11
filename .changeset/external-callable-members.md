---
'svelte-docinfo': patch
---

fix: members typed by external functions stop harvesting the external overload set

A property typed by an external function — `run?: typeof spawn` from
`node:child_process` — classified `kind: 'function'` and enumerated the
package's whole overload set: 20 overloads carrying Node's full
documentation (~27KB from one member), plus `misplaced_tag` /
`unknown_param` warnings pointed at `node_modules` files the user can't act
on. External-origin call signatures now filter before classification — the
membership rule at signature granularity — so a wholly-external callable
documents as the flat type text under `kind: 'variable'`, a mixed callable
keeps its local signatures, and local callables are unchanged.
