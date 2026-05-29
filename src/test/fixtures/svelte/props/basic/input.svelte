<script lang="ts">
	/**
	 * A component with basic typed props.
	 */

	let {
		prop1,
		prop2,
	}: {
		/** Description 1 */
		prop1: string;
		/** Description 2 */
		prop2: number;
	} = $props();
</script>

<div>
	{prop1}
	{prop2}
</div>
