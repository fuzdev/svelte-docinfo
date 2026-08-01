<!--
	@component
	Description 1.
-->

<script lang="ts">
	let { prop1 }: { prop1: string } = $props();

	/** Description 2. */
	let a = $state(0);
</script>

<div>{prop1}{a}</div>
