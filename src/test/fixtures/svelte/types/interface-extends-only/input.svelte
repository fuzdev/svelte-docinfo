<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';

	interface Props extends HTMLButtonAttributes {}

	const { ...rest }: Props = $props();
</script>

<button {...rest}></button>
