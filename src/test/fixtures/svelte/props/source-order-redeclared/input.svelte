<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	// `onclick`, `color`, and `children` also exist on the external bag, so
	// their symbols merge with declarations in svelte/elements — the sort must
	// key on the local declarations and keep the authored order.
	const {
		status = 'inform',
		color,
		onclick,
		disabled,
		children
	}: HTMLAttributes<HTMLElement> & {
		status?: string;
		color?: string;
		/** Renders as a button when provided — the doc on a redeclared name. */
		onclick?: (() => void) | undefined;
		disabled?: boolean;
		children: Snippet;
	} = $props();
</script>

{#if onclick}
	<button type="button" style:color {onclick} {disabled}>{status}{@render children()}</button>
{/if}
