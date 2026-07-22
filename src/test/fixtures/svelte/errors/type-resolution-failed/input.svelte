<script lang="ts">
	// @ts-nocheck
	// Reference non-existent type
	import type { NonExistent } from './missing';

	let {
		prop1
	}: {
		prop1: NonExistent;
	} = $props();
</script>

<div>{prop1}</div>
