<script lang="ts">
	let { a }: { a: string } = $props();
</script>

<svelte:head>
	<script type="application/ld+json">
		{"@context": "https://fuz.dev", "@type": "A", "name": "a"}
	</script>
</svelte:head>

<div>{a}</div>
