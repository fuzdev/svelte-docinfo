<!-- @module
	Description 1

	@example
	```svelte
	<ComponentModuleCommentHtmlIndentedExample>
		<div>text1</div>
	</ComponentModuleCommentHtmlIndentedExample>
	```
-->

<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<div>{@render children()}</div>
