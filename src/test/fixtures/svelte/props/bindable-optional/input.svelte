<script lang="ts">
	let {
		prop1 = $bindable(),
		prop2 = $bindable(),
	}: {
		/** Description 1 */
		prop1: string;
		/** Description 2 */
		prop2?: number;
	} = $props();
</script>

<div>
	<input bind:value={prop1} />
	{#if prop2}<input type="number" bind:value={prop2} />{/if}
</div>
