<svelte:head>
	<script>
		/**
		 * Nested description.
		 *
		 * @module
		 */

		export const nested = 1;
	</script>
</svelte:head>

<script lang="ts" module>
	/**
	 * Module description.
	 *
	 * @module
	 */

	/** Description 1 */
	export const a = 1;

	export type A = 'a' | 'b';
</script>

<script lang="ts">
	let { b }: { b: A } = $props();
</script>

<div>{b}</div>
