---
'svelte-docinfo': minor
---

fix: `@mutates` targets split at the first ` - ` separator

Compound paths and multi-word targets parse whole instead of truncating
at the first word; backticks are stripped so `` `a` `` and `a` are one
key; a separator-less tag is a bare target (empty description, previously
dropped) with continuation lines as the description; multiline
descriptions no longer truncate at the first newline.
