<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';

	interface A extends HTMLButtonAttributes {
		/** Description 1 */
		prop1?: string;
	}

	interface B extends HTMLButtonAttributes {
		/** Description 2 */
		prop2?: number;
	}

	interface Props extends A, B {
		/** Description 3 */
		prop3: string;
	}

	const { prop1, prop2, prop3, ...rest }: Props = $props();
</script>

<button {...rest}>{prop1}{prop2}{prop3}</button>
