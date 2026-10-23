<script lang="ts" module>
	/**
	 * Module docs via the in-script JSDoc form — the `@module` tag marks this
	 * block as the `moduleComment` rather than docs for the statement below.
	 * See `Calculator.svelte` for the HTML comment form.
	 * @module
	 */

	// a template snippet exported from the module script documents as `kind: 'snippet'`
	export { cardFooter };
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	// component docs via the in-script JSDoc form: attached to `$props()`, it needs
	// no `@component` tag (see `Calculator.svelte` for the HTML comment form);
	// the inherited `HTMLAttributes` props are filtered out and listed in `externalTypes`

	/**
	 * A card with a heading or custom header above its body content. Extra
	 * attributes pass through to the root element.
	 */
	const {
		heading,
		header,
		children,
		...rest
	}: HTMLAttributes<HTMLDivElement> & {
		/** Heading rendered when no `header` snippet is provided. */
		heading?: string;
		/** Custom header content, receives the resolved heading. */
		header?: Snippet<[heading: string]>;
		/** Card body content. */
		children: Snippet;
	} = $props();
</script>

{#snippet cardFooter(text: string)}
	<small class="card-footer">{text}</small>
{/snippet}

<div {...rest} class={['card', rest.class]}>
	<div class="card-header">
		{#if header}
			{@render header(heading ?? 'untitled')}
		{:else}
			<h3>{heading ?? 'untitled'}</h3>
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
	.card-footer {
		display: block;
		padding: 0.5rem 1rem;
		border-top: 1px solid #ccc;
	}
</style>
