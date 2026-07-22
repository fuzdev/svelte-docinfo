<!--
	@module
	HTML module docs.
-->

<script lang="ts" module>
	export const HELPER = 'value';
</script>

<script lang="ts">
	let { prop1 }: { prop1: string } = $props();
</script>

<div>{prop1}</div>
