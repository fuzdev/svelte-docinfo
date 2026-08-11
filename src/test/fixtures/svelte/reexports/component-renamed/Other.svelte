<script lang="ts">
	/**
	 * Description 1.
	 */

	let {
		prop1,
		prop2 = 1
	}: {
		/** Description 2 */
		prop1: string;
		prop2?: number;
	} = $props();
</script>

<div>
	{prop1}
	{prop2}
</div>
