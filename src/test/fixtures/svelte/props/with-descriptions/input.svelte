<script lang="ts">
	let {
		prop1,
		prop2,
		prop3 = true
	}: {
		/**
		 * Description 1 line 1.
		 * Description 1 line 2.
		 */
		prop1: string;
		/**
		 * Description 2 line 1.
		 * Description 2 line 2.
		 */
		prop2: number;
		/**
		 * Description 3 line 1.
		 * Description 3 line 2.
		 */
		prop3?: boolean;
	} = $props();
</script>

<div>
	{prop1}
	{prop2}
	{prop3}
</div>
