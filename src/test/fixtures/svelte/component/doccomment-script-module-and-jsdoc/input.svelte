<script module lang="ts">
	/** Description 1. */
	export const a = 'value';
</script>

<script lang="ts">
	/** Description 2. */
	let { prop1 }: { prop1: string } = $props();
</script>

<div>{prop1}</div>
