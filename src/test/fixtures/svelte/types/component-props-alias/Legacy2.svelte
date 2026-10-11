<!-- legacy (`runes={false}`) with svelte2tsx's reserved `$$Props` alias, local to the virtual -->
<svelte:options runes={false} />

<script lang="ts">
	type $$Props = { y: string };

	export let y: string;
</script>

<div>{y}</div>
