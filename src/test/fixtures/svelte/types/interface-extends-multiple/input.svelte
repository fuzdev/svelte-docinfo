<script lang="ts">
	import type { AriaAttributes, DOMAttributes } from 'svelte/elements';

	interface Props extends AriaAttributes, DOMAttributes<HTMLDivElement> {
		/** Description 1 */
		prop1: string;
	}

	const { prop1, ...rest }: Props = $props();
</script>

<div {...rest}>{prop1}</div>
