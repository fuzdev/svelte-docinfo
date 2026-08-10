<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';

	interface Props extends HTMLButtonAttributes {
		/** Description 1 */
		prop1: string;
		/** Description 2 */
		prop2?: 'a' | 'b';
	}

	const { prop1, prop2, ...rest }: Props = $props();
</script>

<button {...rest}>{prop1}{prop2}</button>
