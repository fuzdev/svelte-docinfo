<script lang="ts">
	import type {Snippet} from 'svelte';

	let {
		content,
	}: {
		/** Description 1 */
		content: Snippet<[a: string, b?: number]>;
	} = $props();
</script>

{@render content('text', 1)}
