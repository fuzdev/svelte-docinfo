<script lang="ts">
	import type {Snippet} from 'svelte';

	type A = 'a' | 'b' | 'c' | 'd';

	interface B {
		id: number;
		value: string;
	}

	let {
		prop1,
		prop2,
		prop3,
		prop4,
		prop5,
	}: {
		/** Description 1 */
		prop1: A;
		/** Description 2 */
		prop2: B | null;
		/** Description 3 */
		prop3?: (event: MouseEvent) => void;
		/** Description 4 */
		prop4?: Snippet;
		/** Description 5 */
		prop5?: Array<string>;
	} = $props();
</script>

<button onclick={prop3}>
	{prop1}
	{#if prop2}{prop2.value}{/if}
	{#if prop4}{@render prop4()}{/if}
	{#if prop5}{prop5.join(', ')}{/if}
</button>
