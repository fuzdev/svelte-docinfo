<script lang="ts">
	import {resolve} from '$app/paths';
	import type {Snippet} from 'svelte';
	import Breadcrumb from '@fuzdev/fuz_ui/Breadcrumb.svelte';

	import {extraction_data} from './extraction_data.ts';
	import {ExtractionState, extraction_context} from './extraction_state.svelte.ts';

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

<div class="extraction" data-view={extraction.active_view}>
	<!-- tab bar; visible only in the narrow single-pane layout (see media query) -->
	<div class="tabs">
		<button
			type="button"
			class="color_d"
			class:selected={extraction.active_view === 'modules'}
			onclick={() => (extraction.active_view = 'modules')}
		>
			modules
		</button>
		<button
			type="button"
			class="color_d"
			class:selected={extraction.active_view === 'source'}
			onclick={() => (extraction.active_view = 'source')}
		>
			source
		</button>
		<button
			type="button"
			class="color_d"
			class:selected={extraction.active_view === 'data'}
			onclick={() => (extraction.active_view = 'data')}
		>
			data
		</button>
	</div>
	<div class="sidebar">
		<Breadcrumb class="py_sm" style="flex-wrap: nowrap;" />
		<nav>
			{#each extraction.modules as module (module.path)}
				<a
					class="menuitem"
					class:selected={module.path === extraction.selected_path}
					aria-current={module.path === extraction.selected_path ? 'page' : undefined}
					href={resolve('/demo/extraction/[...module_path]', {module_path: module.path})}
					onclick={() => (extraction.active_view = 'source')}
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
		grid-template-columns: 375px minmax(0, 1fr) minmax(0, 1fr);
	}
	/* the tab bar only drives the narrow single-pane layout; hidden when the
	   three regions sit side by side */
	.tabs {
		display: none;
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

	/* narrow: collapse the three columns into one tabbed pane */
	@media (max-width: 1000px) {
		.extraction {
			grid-template-columns: 1fr;
			grid-template-rows: auto 1fr;
		}
		.tabs {
			display: flex;
			gap: var(--space_xs);
			padding: var(--space_xs) var(--space_sm);
			grid-row: 1;
		}
		.tabs button {
			flex: 1;
		}
		/* every region shares the second row; only the active one is shown, so it
		   fills the remaining height */
		.sidebar,
		.extraction :global(.extraction-pane) {
			grid-row: 2;
			min-height: 0;
		}
		.sidebar {
			display: none;
		}
		.extraction :global(.extraction-pane) {
			display: none;
			border-left: none;
		}
		.extraction[data-view='modules'] .sidebar {
			display: flex;
		}
		.extraction[data-view='source'] :global([data-pane='source']),
		.extraction[data-view='data'] :global([data-pane='data']) {
			display: block;
		}
	}
</style>
