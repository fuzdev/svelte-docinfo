<script lang="ts">
	let { style }: { style?: string } = $props();
</script>

<div class="a" {style}></div>

<style>
	.a {
		color: var(--e, red);
	}
</style>
