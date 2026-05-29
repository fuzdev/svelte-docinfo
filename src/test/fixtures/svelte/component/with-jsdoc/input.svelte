<!--
	@component
	A well-documented component with JSDoc.

	This component demonstrates comprehensive documentation.

	@example
	```svelte
	<ComponentJsdoc value="text" />
	```
-->

<script lang="ts">
	let {
		value,
	}: {
		value: string;
	} = $props();
</script>

<div>{value}</div>
