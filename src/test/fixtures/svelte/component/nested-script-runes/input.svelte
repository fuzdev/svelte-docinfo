<svelte:head>
	<script>
		export let nested = 1;
	</script>
</svelte:head>

<script lang="ts">
	let {
		a,
		b = 1
	}: {
		/** Description 1 */
		a: string;
		b?: number;
	} = $props();
</script>

<div>{a}{b}</div>
