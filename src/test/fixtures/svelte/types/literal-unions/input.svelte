<script lang="ts">
	let {
		prop1,
		prop2,
		prop3,
	}: {
		/** Description 1 */
		prop1: 1 | 2 | 3;
		/** Description 2 */
		prop2: `prefix-${'a' | 'b'}`;
		/** Description 3 */
		prop3: 'value' | 1 | true | null;
	} = $props();
</script>

<div>{prop1} {prop2} {prop3}</div>
