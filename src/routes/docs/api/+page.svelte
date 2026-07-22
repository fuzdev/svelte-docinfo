<script lang="ts">
	import { page } from '$app/state';
	import ApiIndex from '@fuzdev/fuz_ui/ApiIndex.svelte';
	import { DOCS_PATH } from '@fuzdev/fuz_ui/docs_helpers.svelte.ts';

	const at_root = $derived(page.url.pathname === DOCS_PATH);
</script>

<svelte:head>
	<title>API - svelte-docinfo</title>
</svelte:head>

<ApiIndex minimal={at_root} />
