<script lang="ts">
	let {
		prop1 = undefined,
		prop2
	}: {
		/** Description 1 */
		prop1?: string;
		/** Description 2 */
		prop2?: string;
	} = $props();
</script>

<div>{prop1} {prop2}</div>
