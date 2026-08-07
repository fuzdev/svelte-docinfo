<script lang="ts">
	import type { Snippet } from 'svelte';

	type A = 'a' | 'b' | 'c';

	interface B {
		a: string;
	}

	interface Props {
		/** Description 1 */
		a?: A;
		b: Map<string, B>;
		c?: B[];
		d: 'a' | 'b' | null;
		e?: boolean;
		f: string;
		g?: Snippet<[b: B, i: number]>;
	}

	let { a = 'b', b, c, d, e = false, f, g }: Props = $props();
</script>

<div>
	{a}
	{b}
	{c}
	{d}
	{e}
	{f}
	{@render g?.({ a: f }, 0)}
</div>
