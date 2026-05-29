<script lang="ts">
	let {
		prop1,
		prop2,
	}: {
		/** @deprecated */
		prop1: string;
		/**
		 * Description.
		 *
		 * @deprecated
		 */
		prop2: number;
	} = $props();
</script>

<div>{prop1} {prop2}</div>
