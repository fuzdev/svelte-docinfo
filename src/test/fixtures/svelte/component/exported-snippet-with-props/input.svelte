<script module lang="ts">
	export {greet};
</script>

<script lang="ts">
	let {prop1}: {prop1: string} = $props();
</script>

{#snippet greet(a: string)}
	<p>{a}</p>
{/snippet}

<div>{prop1}</div>
