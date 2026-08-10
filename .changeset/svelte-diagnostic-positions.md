---
'svelte-docinfo': patch
---

fix: remap Svelte `<script module>` diagnostic positions to the original source

Diagnostics emitted from a svelte2tsx virtual (`misplaced_tag`,
`unknown_param`, `alias_lost`, `type_extraction_failed`,
`signature_analysis_failed`, `class_member_failed`) had their `file`
normalized to the `.svelte` path while keeping the virtual's line/column —
wrong whenever markup or an instance script shifts the `<script module>`
content. Positions now remap through the source map to the original `.svelte`
source, and an unmappable position (no source map, or a node svelte2tsx
synthesized) drops `line`/`column` instead of publishing a virtual line.

Callers assembling modules themselves through `analyzeModule` /
`analyzeSvelteModule` get the new `finalizeDiagnostics(diagnostics,
{projectRoot, virtualFiles})`, which runs the position remap and
`normalizeDiagnosticPaths` in their required order (remap first — path
normalization strips the virtual suffix the remap matches `file` against).
