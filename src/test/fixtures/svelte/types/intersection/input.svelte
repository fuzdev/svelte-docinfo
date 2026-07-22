<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		prop1,
		prop2,
		...attrs
	}: {
		/** Description 1 */
		prop1: string;
		/** Description 2 */
		prop2?: Record<string, unknown>;
	} & HTMLAttributes<HTMLDivElement> = $props();
</script>

<div {...attrs}>
	{prop1}
	{#if prop2}{JSON.stringify(prop2)}{/if}
</div>
