---
'svelte-docinfo': patch
---

fix: analyze non-finite number literal types instead of throwing

A literal type with no finite value (`1e999`, or an enum member initialized to `1 / 0` or `0 / 0`) failed output validation and aborted the whole analysis. Its `TypeJson` literal node now carries `value` as a string (`"Infinity"`, `"-Infinity"`, or `"NaN"`), the way a bigint literal already does, so the output stays JSON-serializable and round-trips. `text` is unchanged.
