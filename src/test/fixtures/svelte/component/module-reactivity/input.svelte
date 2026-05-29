<!--
	Only $state and $state.raw are exercised here — Svelte rejects
	`export let _ = $derived(...)` from <script module> with
	`derived_invalid_export`. The $derived and $derived.by variants
	are covered by ts/declarations/variable/reactive-derived* fixtures.
-->
<script module lang="ts">
	export let a: number = $state(0);
	export let b: number = $state.raw(0);
</script>

<div>{a} {b}</div>
