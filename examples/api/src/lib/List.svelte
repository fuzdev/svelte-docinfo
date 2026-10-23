<!--
	@component
	Renders `items` as a list, each through the `item` snippet, with an
	optional fallback when the list is empty.
-->

<script lang="ts" generics="T">
	// the `generics` attribute surfaces as the component's `genericParams`

	import type { Snippet } from 'svelte';

	const {
		items,
		item,
		empty
	}: {
		/** Items to render, in order. */
		items: ReadonlyArray<T>;
		/** Renders one item, receiving it and its index. */
		item: Snippet<[item: T, index: number]>;
		/** Rendered in place of the list when `items` is empty. */
		empty?: Snippet;
	} = $props();
</script>

{#if items.length}
	<ul>
		{#each items as value, index}
			<li>{@render item(value, index)}</li>
		{/each}
	</ul>
{:else}
	{@render empty?.()}
{/if}
