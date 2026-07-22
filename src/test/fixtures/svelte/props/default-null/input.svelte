<script lang="ts">
	type A = { a: string } | null;

	let {
		prop1 = null,
		prop2
	}: {
		/** Description 1 */
		prop1?: A;
		/** Description 2 */
		prop2?: A;
	} = $props();
</script>

<div>
	{#if prop1}{prop1.a}{/if}
	{#if prop2}{prop2.a}{/if}
</div>
