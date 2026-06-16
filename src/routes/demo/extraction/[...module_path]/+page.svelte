<script lang="ts">
	import ExtractionView from '$routes/demo/extraction/ExtractionView.svelte';
	import {extraction_context} from '$routes/demo/extraction/extraction_state.svelte.ts';

	const extraction = extraction_context.get();
</script>

<svelte:head>
	<title>{extraction.selected_path} - extraction - svelte-docinfo</title>
</svelte:head>

<ExtractionView />
