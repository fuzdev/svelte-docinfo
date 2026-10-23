<script module lang="ts">
	export { greet };
</script>

{#snippet greet(a: string, b: number = 1)}
	<p>{a} {b}</p>
{/snippet}
