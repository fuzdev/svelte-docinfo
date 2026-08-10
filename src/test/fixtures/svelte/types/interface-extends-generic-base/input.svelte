<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';

	interface A<T extends EventTarget> extends HTMLAttributes<T> {
		/** Description 1 */
		prop1?: string;
	}

	interface Props extends A<HTMLDivElement> {
		/** Description 2 */
		prop2: number;
	}

	const { prop1, prop2, ...rest }: Props = $props();
</script>

<div {...rest}>{prop1}{prop2}</div>
