<script lang="ts">
	let {
		prop1 = $bindable('value'),
		prop2 = $bindable(42),
	}: {
		/** Description 1 */
		prop1?: string;
		/** Description 2 */
		prop2?: number;
	} = $props();
</script>

<div>
	<input bind:value={prop1} />
	<input type="number" bind:value={prop2} />
</div>
