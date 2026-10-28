<!--
@component
@cssprop a - Description 1
-->
<script lang="ts">
	/**
	 * @cssprop b - Description 2
	 */
	let { prop1 }: { prop1: string } = $props();
</script>

<div class="a">{prop1}</div>

<style>
	.a {
		color: var(--a, red);
	}
</style>
