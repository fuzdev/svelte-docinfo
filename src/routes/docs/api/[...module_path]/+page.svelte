<script lang="ts">
	import ApiModule from '@fuzdev/fuz_ui/ApiModule.svelte';

	const { params } = $props();

	const module_path = $derived(params.module_path ?? '');
</script>

<svelte:head>
	<title>{module_path} - svelte-docinfo</title>
</svelte:head>

<ApiModule {module_path} />
