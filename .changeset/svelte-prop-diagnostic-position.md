---
'svelte-docinfo': patch
---

fix: `svelte_prop_failed` drops unmappable positions instead of publishing a virtual line

The per-prop diagnostic names the original `.svelte` file but took its
position from the helper that populates declaration `sourceLine`, which falls
back to the svelte2tsx virtual's own coordinates when the source map can't
resolve a node — so a prop declaration svelte2tsx synthesized would ship a
generated-TS line under a `.svelte` path. It now leaves `line`/`column`
absent, matching the rule the `<script module>` diagnostics already follow.
Mappable positions are unchanged, as is declaration `sourceLine`, which keeps
its fallback deliberately. The branch is latent today — every prop
declaration the extraction anchor reaches maps cleanly — so no output moves.
