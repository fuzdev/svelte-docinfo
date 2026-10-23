<script lang="ts">
	import ExtractionView from '../ExtractionView.svelte';
	import { extraction_context } from '../extraction_state.svelte.ts';

	const extraction = extraction_context.get();
</script>

<svelte:head>
	<title>{extraction.selected_path} - extraction - svelte-docinfo</title>
</svelte:head>

<ExtractionView />
