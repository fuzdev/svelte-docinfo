<script lang="ts">
	let {
		prop1 = $bindable(undefined),
		prop2 = $bindable(),
		prop3 = undefined,
	}: {
		/** Description 1 */
		prop1?: string;
		/** Description 2 */
		prop2?: string;
		/** Description 3 */
		prop3?: string;
	} = $props();
</script>

<div>
	<input bind:value={prop1} />
	<input bind:value={prop2} />
	{prop3}
</div>
