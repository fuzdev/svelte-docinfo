<!-- legacy (`runes={false}`, as in `component/legacy-export-let`) with a slot, so its props are svelte2tsx's shim-declared `__sveltets_2_PropsWithChildren` -->
<svelte:options runes={false} />

<script lang="ts">
	export let z: number;
</script>

<div>{z}<slot /></div>
