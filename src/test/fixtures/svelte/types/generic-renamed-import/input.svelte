<script lang="ts" generics="T extends EventTarget">
	import type { HTMLAttributes as Attrs } from 'svelte/elements';

	const {
		prop1
	}: Attrs<T> & {
		/** Description 1 */
		prop1: string;
	} = $props();
</script>

<div>{prop1}</div>
