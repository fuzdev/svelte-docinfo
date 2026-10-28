<script lang="ts">
	import Other from './Other.svelte';

	let { prop1 }: { prop1: string } = $props();
</script>

<div class="a" style="width: var(--a, 1px); --b: {prop1}" style:margin="var(--c, 2px) var(--d)">
	{prop1}
</div>
<Other --e="var(--f, 3px)" style="color: var(--g, red)" />

<style>
	.a {
		padding: var(--h, 4px) var(--a, 5px);
	}
</style>
