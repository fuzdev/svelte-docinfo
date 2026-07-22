<script module lang="ts">
	export { greet };
</script>

{#snippet greet(a: string, b: number)}
	<p>{a} {b}</p>
{/snippet}
