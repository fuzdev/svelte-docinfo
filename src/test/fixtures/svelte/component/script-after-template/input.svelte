<svelte:options runes={false} />

<div>{a}{b}</div>

<script lang="ts">
	/**
	 * Module description.
	 *
	 * @module
	 */

	/** Description 1 */
	export let a: string;
	export let b = 1;
</script>
