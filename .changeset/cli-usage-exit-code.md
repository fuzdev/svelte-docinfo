---
'svelte-docinfo': patch
---

fix: CLI usage errors exit 2, as documented

An unknown flag or a missing option value now exits 2 like the other CLI errors, leaving 1 for analysis errors. Before, commander exited 1 on its own parse errors.
