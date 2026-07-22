<script lang="ts">
	type A = { a: number };

	let {
		prop1 = { a: 1 },
		prop2 = {},
		prop3 = [1, 2, 3],
		prop4 = [],
		prop5 = `text`,
		prop6 = $bindable(null)
	}: {
		/** Description 1 */
		prop1?: A;
		/** Description 2 */
		prop2?: Record<string, never>;
		/** Description 3 */
		prop3?: number[];
		/** Description 4 */
		prop4?: string[];
		/** Description 5 */
		prop5?: string;
		/** Description 6 */
		prop6?: string | null;
	} = $props();
</script>

<div>
	{prop1.a}
	{JSON.stringify(prop2)}
	{#each prop3 as item}{item}{/each}
	{#each prop4 as item}{item}{/each}
	{prop5}
	<input bind:value={prop6} />
</div>
