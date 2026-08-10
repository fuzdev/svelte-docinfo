<script module lang="ts">
	import type { HTMLButtonAttributes, SvelteHTMLElements } from 'svelte/elements';

	/** An intersection over an external bag — the type-alias path records the bag. */
	export type ButtonProps = HTMLButtonAttributes & {
		/** Description 1 */
		prop1: string;
	};

	/** A union of external bags — the type-alias path skips unions, so this records nothing. */
	export type EitherProps = SvelteHTMLElements['div'] | SvelteHTMLElements['span'];
</script>

<script lang="ts">
	const { ...rest }: EitherProps = $props();
</script>

<div {...rest}></div>
