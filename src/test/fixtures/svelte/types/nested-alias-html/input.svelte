<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';

	type A = HTMLButtonAttributes & {
		/** Description 1 */
		prop1?: string;
	};

	type Props = A & {
		/** Description 2 */
		prop2: number;
	};

	const { prop1, prop2, ...rest }: Props = $props();
</script>

<button {...rest}>{prop1}{prop2}</button>
