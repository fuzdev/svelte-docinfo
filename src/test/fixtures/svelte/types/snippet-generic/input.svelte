<script lang="ts" generics="T">
	import type {Snippet} from 'svelte';

	let {
		data,
		row,
	}: {
		/** Description 1 */
		data: T[];
		/** Description 2 */
		row: Snippet<[d: T]>;
	} = $props();
</script>

<ul>
	{#each data as d}
		<li>{@render row(d)}</li>
	{/each}
</ul>
