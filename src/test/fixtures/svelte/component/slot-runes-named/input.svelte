<script lang="ts">
	let { a }: { a: string } = $props();
</script>

<!-- svelte-ignore slot_element_deprecated -->
<div>{a}<slot name="b" /></div>
