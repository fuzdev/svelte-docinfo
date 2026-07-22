<!--
	@component
	Description.
-->

<script lang="ts">
	interface ComponentProps {
		/** Description 1 */
		prop1: string;
		/** Description 2 */
		prop2?: number;
	}

	let { prop1, prop2 }: ComponentProps = $props();
</script>

<div>{prop1} {prop2}</div>
