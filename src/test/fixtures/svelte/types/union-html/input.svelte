<script lang="ts">
	import type {SvelteHTMLElements} from 'svelte/elements';

	const props: SvelteHTMLElements['h1'] | SvelteHTMLElements['h2'] = $props();
</script>

<h1 {...props}></h1>
