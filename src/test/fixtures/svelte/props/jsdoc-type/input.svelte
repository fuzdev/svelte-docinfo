<!--
@component
Description.
-->

<script>
	/**
	 * @typedef {Object} A
	 * @property {boolean} [prop1] Description 1
	 * @property {string} prop2 Description 2
	 * @property {number} [prop3] - Description 3
	 * @property {import('svelte').Snippet} [children] Description 4
	 * @property {import('svelte').Snippet<[a: string]>} [prop4] Description 5
	 */

	/** @type {A} */
	let { prop1 = true, prop2, prop3 = $bindable(1), children, prop4 } = $props();
</script>

<div>
	{prop1}{prop2}{prop3}
	{#if children}{@render children()}{/if}
	{#if prop4}{@render prop4('a')}{/if}
</div>
