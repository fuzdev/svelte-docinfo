<svelte:options runes={false} />

<script lang="ts">
	export let a: string;
</script>

<div>{a}<slot /><slot name="b" /></div>
