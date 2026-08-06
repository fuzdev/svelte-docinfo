<!--
	@component
	Generic component whose `generics` attribute contains `>` characters.
-->

<script lang="ts" generics="T extends () => void, U extends Record<string, unknown>">
	/**
	 * @module
	 * Module docs for the arrow-generics component.
	 */

	let {
		callback,
		items
	}: {
		/** Callback prop typed by the arrow-constrained param. */
		callback: T;
		/** Items typed by the record-constrained param. */
		items: U[];
	} = $props();
</script>

<div>
	{#each items as item}
		<button type="button" onclick={() => callback()}>{String(item)}</button>
	{/each}
</div>
