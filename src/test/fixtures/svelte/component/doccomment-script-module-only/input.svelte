<!--
	JSDoc in `<script module>` documents that export, never the component —
	svelte2tsx hoists module-script declarations above the component's own
	`$$render` body in the virtual source.
-->

<script module lang="ts">
	/** Description 1. */
	export const a = 'value';
</script>

<script lang="ts">
	let { prop1 }: { prop1: string } = $props();
</script>

<div>{prop1}</div>
