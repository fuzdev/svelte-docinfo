<script lang="ts">
	/**
	 * Description 1.
	 */

	let {
		prop1,
		prop2
	}: {
		/** Description 2 */
		prop1: string;
		prop2?: boolean;
	} = $props();
</script>

<div>
	{prop1}
	{prop2}
</div>
