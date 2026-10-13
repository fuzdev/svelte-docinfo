<script lang="ts">
	let a = $state(1);
	// svelte-ignore non_reactive_update
	let b = 1;
	export { b };
</script>

<!-- svelte-ignore slot_element_deprecated -->
<div>{a} {b}<slot /></div>
