<svelte:options runes={false} />

<script lang="ts">
	export let prop1: string;
</script>

<div class="a" style:--b={prop1}>{prop1}</div>

<style>
	.a {
		color: var(--a, red);
		margin: var(--b, 1px);
	}
</style>
