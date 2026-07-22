<script lang="ts">
	let {
		prop1,
		prop2,
		prop3 = true
	}: {
		/** Description 1 */
		prop1: string;
		/** Description 2 */
		prop2?: string;
		/** Description 3 */
		prop3?: boolean;
	} = $props();
</script>

<div>
	{prop1}
	{#if prop2}{prop2}{/if}
	{prop3}
</div>
