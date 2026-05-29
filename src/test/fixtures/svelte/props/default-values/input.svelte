<script lang="ts">
	let {
		prop1 = 'value',
		prop2 = 1,
	}: {
		/**
		 * Description 1
		 * @default "value"
		 */
		prop1?: string;
		/**
		 * Description 2
		 * @default 1
		 */
		prop2?: number;
	} = $props();
</script>

<div>{prop1} {prop2}</div>
