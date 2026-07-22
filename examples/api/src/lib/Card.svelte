<script lang="ts">
	/**
	 * Module docs via the in-script JSDoc form — the `@module` tag marks this
	 * block as the `moduleComment` rather than docs for the statement below.
	 * See `Calculator.svelte` for the HTML comment form.
	 * @module
	 */

	import type { Snippet } from 'svelte';

	/**
	 * Card layout demonstrating `children` and snippet props —
	 * `acceptsChildren` and structured snippet parameters in the output.
	 * Component docs via the in-script JSDoc form — attached to the `$props()`
	 * declaration, this block becomes the component's `docComment`, with no
	 * `@component` tag required (only the HTML form needs that tag). See
	 * `Calculator.svelte` for the HTML comment form.
	 */
	let {
		title,
		header,
		children
	}: {
		/** Title rendered when no `header` snippet is provided. */
		title?: string;
		/** Custom header content, receives the resolved title. */
		header?: Snippet<[title: string]>;
		/** Card body content. */
		children: Snippet;
	} = $props();
</script>

<div class="card">
	<div class="card-header">
		{#if header}
			{@render header(title ?? 'untitled')}
		{:else}
			<h3>{title ?? 'untitled'}</h3>
		{/if}
	</div>
	<div class="card-body">
		{@render children()}
	</div>
</div>

<style>
	.card {
		border: 1px solid #ccc;
		border-radius: 4px;
	}
	.card-header {
		padding: 0.5rem 1rem;
		border-bottom: 1px solid #ccc;
	}
	.card-header h3 {
		margin: 0;
	}
	.card-body {
		padding: 1rem;
	}
</style>
