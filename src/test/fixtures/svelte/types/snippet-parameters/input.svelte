<script lang="ts">
	import type {Snippet} from 'svelte';

	let {
		content,
		header,
	}: {
		/** Description 1 */
		content: Snippet<[text: string, index: number]>;
		/** Description 2 */
		header?: Snippet<[title: string]>;
	} = $props();
</script>

<div>
	{#if header}{@render header('text')}{/if}
	{@render content('text', 1)}
</div>
