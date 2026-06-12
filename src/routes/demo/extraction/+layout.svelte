<script lang="ts">
	import {resolve} from '$app/paths';
	import type {Snippet} from 'svelte';
	import Breadcrumb from '@fuzdev/fuz_ui/Breadcrumb.svelte';

	import {extraction_data} from './extraction_data.js';
	import {ExtractionState, extraction_context} from './extraction_state.svelte.js';

	const {
		children,
	}: {
		children: Snippet;
	} = $props();

	// Analysis and raw sources of the examples/api corpus, committed by
	// `extraction_data.gen.json.ts` — re-run `gro gen` after corpus changes.
	const {modules, sources} = extraction_data;

	const extraction = extraction_context.set(new ExtractionState({modules, sources}));
</script>

<div class="extraction">
	<div class="sidebar">
		<Breadcrumb class="py_sm" style="flex-wrap: nowrap;" />
		<nav>
			{#each extraction.modules as module (module.path)}
				<a
					class="menuitem"
					class:selected={module.path === extraction.selected_path}
					aria-current={module.path === extraction.selected_path ? 'page' : undefined}
					href={resolve('/demo/extraction/[...module_path]', {module_path: module.path})}
				>
					{module.path}
				</a>
			{/each}
		</nav>
	</div>
	{@render children()}
</div>

<style>
	.extraction {
		height: 100%;
		display: grid;
		grid-template-columns: 200px minmax(0, 1fr) minmax(0, 1fr);
	}
	.sidebar {
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	/* ellipsize the final breadcrumb piece (the long one) instead of wrapping;
	   :global because props can't reach the component's inner anchors */
	.sidebar :global(.breadcrumb a) {
		flex-shrink: 0;
	}
	.sidebar :global(.breadcrumb a:last-child) {
		flex-shrink: 1;
		display: block;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	nav {
		flex: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
	}
	nav a {
		font-family: var(--font_family_mono);
		white-space: nowrap;
	}
</style>
