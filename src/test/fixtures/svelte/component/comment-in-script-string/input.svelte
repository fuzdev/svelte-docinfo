<script lang="ts">
	let { prop1 }: { prop1: string } = $props();
	const sample = `<!--
@component
Description 1.
-->
<!--
@module
Description 2.
-->`;
</script>

<div>{prop1}{sample}</div>

<style>
	/* <!-- @component Description 3. --> */
	div {
		color: inherit;
	}
</style>
