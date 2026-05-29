<script lang="ts">
	/**
	 * Component with bindable props.
	 */

	let {
		prop1,
		prop2 = $bindable(),
		prop3 = $bindable(),
	}: {
		/** Description 1 */
		prop1: string;
		/** Description 2 */
		prop2: string;
		/** Description 3 */
		prop3: boolean;
	} = $props();
</script>

<div>
	{prop1}
	<input bind:value={prop2} />
	<input type="checkbox" bind:checked={prop3} />
</div>
