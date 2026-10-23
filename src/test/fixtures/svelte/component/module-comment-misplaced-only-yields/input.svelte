<script lang="ts" module>
	/**
	 * Description 1
	 *
	 * @module
	 */

	export const a = 'value';
</script>

<script lang="ts">
	/**
	 * @nodocs
	 * @module
	 */

	let { prop1 }: { prop1: string } = $props();
</script>

<div>{prop1}</div>
