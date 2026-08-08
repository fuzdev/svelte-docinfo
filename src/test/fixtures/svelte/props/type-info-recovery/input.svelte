<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Box {
		out: { a: string; b: number };
	}
	type Inferred = Box['out'];

	interface Props {
		/** A schema-inferred prop — the tree recovers the written name. */
		item: Inferred;
		maybe?: Inferred;
		row?: Snippet<[entry: Inferred, i: number]>;
	}

	let { item, maybe, row }: Props = $props();
</script>

<div>
	{item.a}
	{maybe?.b}
	{@render row?.(item, 0)}
</div>
