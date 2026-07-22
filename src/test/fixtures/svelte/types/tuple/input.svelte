<script lang="ts">
	let {
		coordinates,
		rgb
	}: {
		/** Description 1 */
		coordinates: [number, number];
		/** Description 2 */
		rgb: [number, number, number];
	} = $props();
</script>

<div style="left: {coordinates[0]}px; top: {coordinates[1]}px; color: rgb({rgb.join(',')});">
	text
</div>
