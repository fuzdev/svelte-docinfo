<!--
	@component
	HTML component description.
-->

<script>
	// @ts-nocheck svelte2tsx copies this JSDoc onto the props it returns, declaring `A` twice
	/**
	 * JSDoc component description.
	 * @typedef {{prop1: string}} A
	 * @type {A}
	 */
	let { prop1 } = $props();
</script>

<p>{prop1}</p>
