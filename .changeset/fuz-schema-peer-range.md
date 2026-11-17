---
'svelte-docinfo': patch
---

deps: depend on '@fuzdev/fuz_schema' `^0.5.7 || ^0.6.0`, admitting 0.6, so a consumer on 0.6 shares one copy instead of nesting a second; a caret per minor, not `>=`, since as a dependency the newest match installs, and 0.6.0's type changes compile here unchanged
