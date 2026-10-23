<!--
	@module
	Description 1 with a `*/` in it.

	@example
	```svelte
	<ComponentModuleCommentHtmlTags prop1="a" />
	```
	@deprecated Description 2
	@see https://fuz.dev
	@see https://fuz.dev/a
	continued on Description 3
	@internal
-->

<script lang="ts">
	let { prop1 }: { prop1: string } = $props();
</script>

<div>{prop1}</div>
