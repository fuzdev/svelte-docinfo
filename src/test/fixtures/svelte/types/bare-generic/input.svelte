<script lang="ts">
	import type {HTMLAttributes} from 'svelte/elements';

	const props: HTMLAttributes<HTMLDivElement> = $props();
</script>

<div {...props}></div>
