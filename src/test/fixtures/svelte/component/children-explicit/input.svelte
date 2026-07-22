<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		children
	}: {
		/** Description 1 */
		children: Snippet;
	} = $props();
</script>

<div>{@render children()}</div>
