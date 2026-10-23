<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Snippet } from 'svelte';
	import Breadcrumb from '@fuzdev/fuz_ui/Breadcrumb.svelte';

	import { extraction_data } from './extraction_data.ts';
	import { ExtractionState, extraction_context } from './extraction_state.svelte.ts';

	const {
		children
	}: {
		children: Snippet;
	} = $props();

	// analysis and raw sources of the examples/api corpus, committed by
	// `extraction_data.gen.json.ts` — re-run `gro gen` after corpus changes
	const extraction = extraction_context.set(new ExtractionState(extraction_data));

	// dragged column widths in px; null keeps the default track
	// (the sidebar sized to its links, the source pane an even split)
	let sidebar_width: number | null = $state(null);
	let source_width: number | null = $state(null);

	const MIN_COLUMN_WIDTH = 120;

	let extraction_el: HTMLElement | undefined = $state();

	const start_resize = (e: PointerEvent, column: 'sidebar' | 'source'): void => {
		if (e.button !== 0 || !extraction_el) return;
		e.preventDefault();
		const handle = e.currentTarget as HTMLElement;
		handle.setPointerCapture(e.pointerId);
		const container = extraction_el.getBoundingClientRect();
		// the source pane starts at the sidebar handle
		const sidebar_handle = extraction_el.querySelector('.extraction-resizer');
		const onmove = (e: PointerEvent) => {
			if (column === 'sidebar') {
				const max = container.width - (source_width ?? 0) - 2 * MIN_COLUMN_WIDTH;
				sidebar_width = clamp(e.clientX - container.left, MIN_COLUMN_WIDTH, max);
			} else {
				const left = sidebar_handle!.getBoundingClientRect().left;
				source_width = clamp(
					e.clientX - left,
					MIN_COLUMN_WIDTH,
					container.right - left - MIN_COLUMN_WIDTH
				);
			}
		};
		const onup = () => {
			handle.removeEventListener('pointermove', onmove);
			handle.removeEventListener('pointerup', onup);
			handle.removeEventListener('pointercancel', onup);
		};
		handle.addEventListener('pointermove', onmove);
		handle.addEventListener('pointerup', onup);
		handle.addEventListener('pointercancel', onup);
	};

	const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));
</script>

<div
	class="extraction"
	data-view={extraction.active_view}
	bind:this={extraction_el}
	style:--extraction-sidebar-width={sidebar_width === null ? null : `${sidebar_width}px`}
	style:--extraction-source-width={source_width === null ? null : `${source_width}px`}
>
	<!-- spans every column, so the module links alone size the sidebar -->
	<header>
		<Breadcrumb class="py_sm" style="flex-wrap: nowrap;" />
	</header>
	<!-- tab bar; visible only in the narrow single-pane layout (see media query) -->
	<div class="tabs">
		<button
			type="button"
			class="palette_d"
			class:selected={extraction.active_view === 'modules'}
			onclick={() => (extraction.active_view = 'modules')}
		>
			modules
		</button>
		<button
			type="button"
			class="palette_d"
			class:selected={extraction.active_view === 'source'}
			onclick={() => (extraction.active_view = 'source')}
		>
			source
		</button>
		<button
			type="button"
			class="palette_d"
			class:selected={extraction.active_view === 'data'}
			onclick={() => (extraction.active_view = 'data')}
		>
			data
		</button>
	</div>
	<div class="sidebar">
		<nav>
			{#each extraction.modules as module (module.path)}
				<a
					class="menuitem"
					class:selected={module.path === extraction.selected_path}
					aria-current={module.path === extraction.selected_path ? 'page' : undefined}
					href={resolve('/demo/extraction/[...module_path]', { module_path: module.path })}
					onclick={() => (extraction.active_view = 'source')}
				>
					{module.path}
					{#if extraction.diagnostics_by_path.has(module.path)}
						<span class="extraction-flag" title="has diagnostics">⚠</span>
					{/if}
				</a>
			{/each}
		</nav>
	</div>
	<!-- drag to resize, double-click to restore the default width -->
	<div
		class="extraction-resizer"
		style:grid-column="2"
		role="separator"
		aria-orientation="vertical"
		aria-label="resize the module list"
		onpointerdown={(e) => start_resize(e, 'sidebar')}
		ondblclick={() => (sidebar_width = null)}
	></div>
	<div
		class="extraction-resizer"
		style:grid-column="4"
		role="separator"
		aria-orientation="vertical"
		aria-label="resize the source pane"
		onpointerdown={(e) => start_resize(e, 'source')}
		ondblclick={() => (source_width = null)}
	></div>
	{@render children()}
</div>

<style>
	.extraction {
		height: 100%;
		display: grid;
		/* sidebar, handle, source, handle, data; the zero-width handle tracks
		   overlap the pane borders */
		grid-template-columns:
			var(--extraction-sidebar-width, auto) 0 var(--extraction-source-width, minmax(0, 1fr))
			0 minmax(0, 1fr);
		grid-template-rows: auto minmax(0, 1fr);
	}
	.extraction :global([data-pane='source']) {
		grid-column: 3;
	}
	.extraction :global([data-pane='data']) {
		grid-column: 5;
	}
	.extraction-resizer {
		grid-row: 2;
		position: relative;
		z-index: 1;
	}
	/* the hit area straddles the column boundary */
	.extraction-resizer::before {
		content: '';
		position: absolute;
		inset: 0 -4px;
		cursor: col-resize;
		touch-action: none;
	}
	.extraction-resizer:hover::before,
	.extraction-resizer:active::before {
		background: var(--border_color_50);
	}
	header {
		grid-column: 1 / -1;
		min-width: 0;
		border-bottom: var(--border_width) var(--border_style) var(--border_color_50);
	}
	/* the tab bar only drives the narrow single-pane layout; hidden when the
	   three regions sit side by side */
	.tabs {
		display: none;
	}
	.sidebar {
		grid-column: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	/* ellipsize the final breadcrumb piece (the long one) instead of wrapping;
	   :global because props can't reach the component's inner anchors */
	header :global(.breadcrumb a) {
		flex-shrink: 0;
	}
	header :global(.breadcrumb a:last-child) {
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
	.extraction-flag {
		margin-left: var(--space_xs);
		color: var(--caution_50);
	}

	/* narrow: collapse the three columns into one tabbed pane */
	@media (max-width: 1000px) {
		.extraction {
			grid-template-columns: 1fr;
			grid-template-rows: auto auto minmax(0, 1fr);
		}
		.tabs {
			display: flex;
			gap: var(--space_xs);
			padding: var(--space_xs) var(--space_sm);
			grid-row: 2;
		}
		.tabs button {
			flex: 1;
		}
		/* every region shares the third row; only the active one is shown, so it
		   fills the remaining height */
		.extraction-resizer {
			display: none;
		}
		.sidebar,
		.extraction :global(.extraction-pane) {
			grid-column: 1;
			grid-row: 3;
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
