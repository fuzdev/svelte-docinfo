<script lang="ts">
	let {
		prop1,
		prop2,
		prop3,
		prop4,
		prop5
	}: {
		/** Description 1 */
		prop1?: null;
		/** Description 2 */
		prop2?: string | null;
		/** Description 3 */
		prop3?: (() => void) | null;
		/** Description 4 */
		prop4?: string;
		/** Description 5 */
		prop5?: () => void;
	} = $props();
</script>

<div>
	{prop1}
	{prop2}
	{prop3}
	{prop4}
	{prop5}
</div>
