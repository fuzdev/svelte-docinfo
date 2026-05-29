<script lang="ts">
	// This is intentionally malformed to test error handling
	// Missing type annotation, unusual structure
	let {untyped_prop} = $props();
</script>

<div>{untyped_prop}</div>
