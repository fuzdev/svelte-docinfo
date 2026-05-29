<script lang="ts">
	import type {Snippet} from 'svelte';
	import type {SvelteHTMLElements} from 'svelte/elements';

	let {
		prop1 = 'a',
		prop2 = false,
		prop3,
		...attrs
	}: SvelteHTMLElements['button'] & {
		/** Description 1 */
		prop1?: 'a' | 'b';
		/** Description 2 */
		prop2?: boolean;
		/** Description 3 */
		prop3?: Snippet;
	} = $props();
</script>

<button disabled={prop2} {...attrs}>
	{#if prop2}text{:else if prop3}{@render prop3()}{/if}
	{prop1}
</button>
