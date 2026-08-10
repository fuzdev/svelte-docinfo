<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';

	interface A extends HTMLButtonAttributes {
		/** Description 1 */
		prop1?: string;
	}

	interface Props extends A {
		/** Description 2 */
		prop2: number;
	}

	const { prop1, prop2, ...rest }: Props = $props();
</script>

<button {...rest}>{prop1}{prop2}</button>
