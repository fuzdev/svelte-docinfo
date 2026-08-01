<!--
	@component
	Description 1.
-->

<script module lang="ts">
	/** Description 2. */
	export const a = 'value';
</script>

<script lang="ts">
	let { prop1 }: { prop1: string } = $props();
</script>

<div>{prop1}</div>
