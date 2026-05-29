<script module lang="ts">
	export {greet};
	export const fn1 = (a: string): number => a.length;
</script>

{#snippet greet(a: string)}
	<p>{a}</p>
{/snippet}
