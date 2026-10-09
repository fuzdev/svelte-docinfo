---
'svelte-docinfo': patch
---

fix: make output independent of the order files are discovered or ingested

The same files now give the same output whether they come from discovery, one batch,
or many `setFile` calls. Before, a union with no alias origin, like `z.enum` members,
could print its members in a different order from run to run.
