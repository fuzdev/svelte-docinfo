<script lang="ts">
	let { prop1 }: { prop1: string } = $props();
</script>

<div>
	{#if prop1}
		<span>{prop1}</span>
	{/if}
</div>
