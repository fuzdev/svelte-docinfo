<script lang="ts">
	let { prop1 }: { prop1: string } = $props();
</script>

<div class="a">{prop1}</div>

<style>
	.a {
		color: var(--a, red);
		margin: var(--b);
		padding: var(--c, 1px) var(--d, 2px);
		border-width: var(--e,);
	}
</style>
