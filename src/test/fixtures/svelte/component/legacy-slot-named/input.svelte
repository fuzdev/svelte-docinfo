<svelte:options runes={false} />

<script lang="ts">
	export let a: string;
</script>

<div>{a}<slot name="b" x={1} /></div>
