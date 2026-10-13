<svelte:options runes={false} />

<script lang="ts">
	import type { A, B } from './a.ts';

	/** Description 1 */
	export let a: string;
	/**
	 * Description 2
	 *
	 * @deprecated Description 3
	 * @since 1.0.0
	 */
	export let b = 1;
	export let c: A | undefined = undefined;
	export let d: B = 'a';
	export let e: Array<A> = [];
	export let f: number | null;
	/** @default 'value' */
	export let g: string | undefined = undefined;
	export let h;
</script>

<div>{a} {b} {c?.a} {d} {e.length} {f} {g} {h}</div>
