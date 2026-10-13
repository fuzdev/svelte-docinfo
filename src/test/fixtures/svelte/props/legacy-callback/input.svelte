<svelte:options runes={false} />

<script lang="ts">
	import type { Snippet } from 'svelte';

	export let a: (x: number, y?: string) => boolean;
	/** Description 1 */
	export let b: (() => void) | undefined = undefined;
	export let c = (x: number): number => x;
	export let d: Snippet<[x: number]> | undefined = undefined;
</script>

<button onclick={() => (a(1), b?.(), c(1))}>{@render d?.(1)}</button>
