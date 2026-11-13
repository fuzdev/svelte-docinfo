---
'svelte-docinfo': patch
---

fix: an unbraced `@throws` reads a backticked first word as its type, so `` @throws `TypeError` if … `` records `TypeError` where it recorded no type and kept the backticked word in the description
