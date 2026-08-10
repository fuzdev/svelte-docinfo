<script lang="ts">
	import type { HTMLAttributes as Attrs } from 'svelte/elements';

	type Props = Attrs<HTMLDivElement> & {
		/** Description 1 */
		prop1: string;
	};

	const { prop1, ...rest }: Props = $props();
</script>

<div {...rest}>{prop1}</div>
