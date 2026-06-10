<script lang="ts">
	import Code from '@fuzdev/fuz_code/Code.svelte';

	import {extraction_context} from './extraction_state.svelte.js';

	// keeps the code block from clipping inside the scrolling pane
	const CODE_STYLE = 'max-width: none; min-height: 100%; overflow: visible;';

	const extraction = extraction_context.get();
</script>

<!-- the two panes are grid items of the layout's `.extraction` grid -->
{#if extraction.selected_module}
	<div class="extraction-pane">
		<Code
			content={extraction.selected_source}
			lang={extraction.selected_lang}
			nomargin
			style={CODE_STYLE}
		/>
	</div>
	<div class="extraction-pane">
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
</style>
