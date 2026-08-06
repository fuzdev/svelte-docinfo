<!--
	`svelte:options` opts out of this repo's `runes: true` compiler option so
	svelte-check accepts `export let` — the same override a real legacy
	component needs in a runes-forced project. The analyzer itself never reads
	the option; legacy detection is syntactic.
-->
<svelte:options runes={false} />

<!--
	@component
	Description.
-->

<script lang="ts">
	/** Description 1 */
	export let prop1: string;
	export let prop2 = 1;
	let a = true;
	export { a as prop3 };
</script>

<div>{prop1} {prop2} {a}</div>
