<script lang="ts" module>
	/**
	 * Description 1
	 *
	 * @see {@link a}
	 * @internal Description 2
	 * @since 1.0.0
	 * @module
	 */

	export const a = 'value';
</script>

<script lang="ts">
	let { prop1 }: { prop1: string } = $props();
</script>

<div>{prop1}</div>
