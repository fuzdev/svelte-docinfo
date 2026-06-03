<script lang="ts">
	import type {SvelteHTMLElements} from 'svelte/elements';

	const {label, ...rest}: (SvelteHTMLElements['div'] | SvelteHTMLElements['span']) & {
		/** A label rendered inside the element. */
		label: string;
	} = $props();
</script>

<div {...rest}>{label}</div>
