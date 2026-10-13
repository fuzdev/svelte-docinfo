<svelte:options runes={false} />

<svelte:head>
	<script>
		export let nested = 1;
	</script>
</svelte:head>

<script lang="ts">
	/** Description 1 */
	export let a: string;
	export let b = 1;
</script>

<div>{a}{b}</div>
