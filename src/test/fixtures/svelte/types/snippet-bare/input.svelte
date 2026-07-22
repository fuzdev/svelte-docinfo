<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		prop1,
		prop2
	}: {
		/** Description 1 */
		prop1: Snippet;
		/** Description 2 */
		prop2?: Snippet;
	} = $props();
</script>

<div>
	{@render prop1()}
	{#if prop2}{@render prop2()}{/if}
</div>
