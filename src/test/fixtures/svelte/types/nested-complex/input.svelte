<script lang="ts">
	interface A {
		b: {
			c: {
				d: string;
				e: number[];
			}[];
		};
	}

	let {
		prop1,
		prop2,
	}: {
		/** Description 1 */
		prop1: A;
		/** Description 2 */
		prop2: Array<Array<{id: number; values: string[]}>>;
	} = $props();
</script>

<div>
	{prop1.b.c[0]?.d}
	{#if prop2}{prop2[0]?.[0]?.id}{/if}
</div>
