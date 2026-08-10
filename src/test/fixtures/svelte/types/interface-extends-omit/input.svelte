<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';

	interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'onclick'> {
		/** Description 1 */
		prop1: string;
	}

	const { prop1 }: Props = $props();
</script>

<div>{prop1}</div>
