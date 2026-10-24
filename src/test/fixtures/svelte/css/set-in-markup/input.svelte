<script lang="ts">
	import type { Component } from 'svelte';

	let { prop1, prop2 }: { prop1: string; prop2: Component } = $props();
	const Prop2 = $derived(prop2);
</script>

<div class="a" style:--a={prop1} style="--b: {prop1}; color: red; --c:1px">
	{#if prop1}
		<span style:--d="1px"></span>
	{:else}
		<svelte:element this={prop1} style="--e: 1px"></svelte:element>
	{/if}
	<Prop2 --f="1px" />
</div>

<style>
	.a {
		margin: var(--a, 1px) var(--b, 1px) var(--c, 1px) var(--d, 1px);
		padding: var(--e, 1px) var(--f, 1px);
	}
</style>
