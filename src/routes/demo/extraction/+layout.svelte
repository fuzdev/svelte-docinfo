<script lang="ts">
	import {resolve} from '$app/paths';
	import {modules} from 'virtual:svelte-docinfo';
	import type {Snippet} from 'svelte';
	import Breadcrumb from '@fuzdev/fuz_ui/Breadcrumb.svelte';
	import {strip_start} from '@fuzdev/fuz_util/string.js';

	import {ExtractionState, extraction_context} from './extraction_state.svelte.js';

	const {
		children,
	}: {
		children: Snippet;
	} = $props();

	// Raw source of every analyzed module, bundled into this demo's chunk only,
	// re-keyed from Vite glob ids to module paths matching `ModuleJson.path`.
	const sources = Object.fromEntries(
		Object.entries(
			import.meta.glob<string>('/src/lib/**/*.{ts,svelte,css,json}', {
				query: '?raw',
				import: 'default',
				eager: true,
			}),
		).map(([id, content]) => [strip_start(id, '/src/lib/'), content]),
	);

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
		grid-template-columns: 375px minmax(0, 1fr) minmax(0, 1fr);
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
