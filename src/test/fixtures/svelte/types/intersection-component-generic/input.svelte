<script lang="ts" generics="T extends EventTarget">
	import type { HTMLAttributes } from 'svelte/elements';

	const {
		prop1
	}: HTMLAttributes<T> & {
		/** Description 1 */
		prop1: string;
	} = $props();
</script>

<div>{prop1}</div>
