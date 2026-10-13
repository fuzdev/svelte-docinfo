<svelte:options runes={true} />

<script lang="ts">
	const a = 1;
</script>

<!-- svelte-ignore slot_element_deprecated -->
<div>{a}<slot /></div>
