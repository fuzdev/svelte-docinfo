<script lang="ts">
	import type { SvelteHTMLElements } from 'svelte/elements';

	const { ...rest }: SvelteHTMLElements['li'] = $props();
</script>

<li {...rest}></li>
