---
'svelte-docinfo': minor
---

feat: `internalMessage` from the `@internal` tag on declarations and members

All declaration variants and member kinds gain optional `internalMessage`,
mirroring `deprecatedMessage`: presence means the tag was written, an empty
string is a bare tag, and trailing prose (`@internal used during development`)
is the value — previously tag and prose vanished silently. A marker, not an
exclusion: the declaration stays documented (`@nodocs` remains the exclusion
tag). Symbol-scope like `@deprecated`: on a non-primary overload it emits
`misplaced_tag` (whose `tagName` enum gains `'internal'`) and is dropped.
Deliberately not on `ComponentPropJson`.
