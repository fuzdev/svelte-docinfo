<script lang="ts">
	import type {Snippet} from 'svelte';

	const {
		children,
	}: {
		children: Snippet;
	} = $props();
</script>

<main>
	{@render children()}
</main>

<style>
	main {
		height: 100vh;
		overflow: auto;
	}
</style>
