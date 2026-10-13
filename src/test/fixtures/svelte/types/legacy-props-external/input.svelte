<svelte:options runes={false} />

<script lang="ts">
	import type { SvelteHTMLElements } from 'svelte/elements';

	type $$Props = Pick<SvelteHTMLElements['button'], 'id' | 'class' | 'disabled'> & {
		/** Description 1 */
		a?: 'a' | 'b';
		/** Description 2 */
		b: number;
		c?: string;
		[key: `data-${string}`]: unknown;
	};

	export let disabled: $$Props['disabled'] = false;
	export let c: $$Props['c'] = 'value';
	export let a: $$Props['a'] = 'a';
</script>

<button {disabled} {...$$restProps}>{a} {c}</button>
