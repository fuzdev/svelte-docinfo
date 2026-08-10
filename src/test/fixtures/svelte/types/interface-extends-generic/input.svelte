<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';

	interface Props extends HTMLAttributes<HTMLDivElement> {
		/** Description 1 */
		prop1: string;
	}

	const { prop1, ...rest }: Props = $props();
</script>

<div {...rest}>{prop1}</div>
