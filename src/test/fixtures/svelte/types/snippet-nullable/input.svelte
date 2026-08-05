<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		prop1,
		prop2
	}: {
		/** Description 1 */
		prop1: Snippet<[a: string]> | null;
		/** Description 2 */
		prop2?: Snippet<[b: string]> | null;
	} = $props();
</script>

{@render prop1?.('text')}
{@render prop2?.('text')}
