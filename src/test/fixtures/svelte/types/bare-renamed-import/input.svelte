<script lang="ts">
	import type { SvelteHTMLElements as Elements } from 'svelte/elements';

	const { ...rest }: Elements['li'] = $props();
</script>

<li {...rest}></li>
