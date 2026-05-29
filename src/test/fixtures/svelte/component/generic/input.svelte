<!--
	@component
	Description.
-->

<script lang="ts" generics="T">
	let {
		prop1,
	}: {
		/** Description 1 */
		prop1: T[];
	} = $props();
</script>

<div>
	{#each prop1 as item}
		<span>{String(item)}</span>
	{/each}
</div>
