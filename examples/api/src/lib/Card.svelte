<!--
	@component
	Card layout demonstrating `children` and snippet props —
	`acceptsChildren` and structured snippet parameters in the output.
-->

<script lang="ts">
	import type {Snippet} from 'svelte';

	let {
		title,
		header,
		children,
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
