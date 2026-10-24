<!--
@component
Description 1

@cssprop --b - Description 2
-->
<script lang="ts">
	/**
	 * Description 3
	 *
	 * @cssprop --a - Description 4
	 * @cssprop --x - Description 5
	 */
	let { prop1 }: { prop1: string } = $props();
</script>

<div class="a">{prop1}</div>

<style>
	.a {
		color: var(--a, red);
		margin: var(--b, 1px);
	}
</style>
