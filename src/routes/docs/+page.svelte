<script lang="ts">
	import DocsContent from '@fuzdev/fuz_ui/DocsContent.svelte';
	import {tomes_context} from '@fuzdev/fuz_ui/tome.js';
	import {library_context} from '@fuzdev/fuz_ui/library.svelte.js';

	const get_tomes_by_slug = tomes_context.get();
	const tomes = $derived(Array.from(get_tomes_by_slug().values()));

	const library = library_context.get();
</script>

<div class="pt_xl3">
	<DocsContent {tomes} {library}></DocsContent>
</div>
