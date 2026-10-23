<script lang="ts">
	import Code from '@fuzdev/fuz_code/Code.svelte';

	import { extraction_context } from './extraction_state.svelte.ts';

	// keeps the code block from clipping inside the scrolling pane
	const CODE_STYLE = 'max-width: none; min-height: 100%; overflow: visible; background: none;';

	const extraction = extraction_context.get();
</script>

<!-- the two panes are grid items of the layout's `.extraction` grid -->
{#if extraction.selected_module}
	<div class="extraction-pane" data-pane="source">
		<Code
			content={extraction.selected_source}
			lang={extraction.selected_lang}
			nomargin
			style={CODE_STYLE}
		/>
	</div>
	<div class="extraction-pane" data-pane="data">
		{#if extraction.selected_diagnostics.length}
			<!-- the envelope's `diagnostics` for this module's file, which the
			     module JSON below doesn't carry -->
			<ul class="extraction-diagnostics unstyled px_md py_sm">
				{#each extraction.selected_diagnostics as d (d)}
					<li>
						<strong>{d.severity}</strong> <code>{d.kind}</code>
						{#if d.line !== undefined}line {d.line}:{/if}
						{d.message}
					</li>
				{/each}
			</ul>
		{/if}
		<Code content={extraction.selected_data} lang="json" nomargin style={CODE_STYLE} />
	</div>
{:else}
	<p class="p_lg">module not found: {extraction.selected_path}</p>
{/if}

<style>
	/* panes own scrolling in both axes; the inline styles on `Code` keep the
	   code block from clipping (max-width/overflow overrides on the element) */
	.extraction-pane {
		overflow: auto;
		border-left: var(--border_width) var(--border_style) var(--border_color_50);
	}
	.extraction-diagnostics {
		border-bottom: var(--border_width) var(--border_style) var(--border_color_50);
	}
</style>
