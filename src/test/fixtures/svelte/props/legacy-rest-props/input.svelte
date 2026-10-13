<svelte:options runes={false} />

<script lang="ts">
	export let a = 'value';
</script>

<div {...$$restProps} data-attr1={$$props.b}>{a}</div>
