<script lang="ts">
	import type { ComponentProps } from 'svelte';

	import Other from './Other.svelte';

	let { prop }: { prop?: ComponentProps<typeof Other>['a'] } = $props();
</script>

<Other a={prop ?? 'a'} />
