<script lang="ts">
	/**
	 * Description 1
	 *
	 * @example
	 * ```svelte
	 * <ComponentModuleCommentTags prop1="a" />
	 * ```
	 * @see https://fuz.dev
	 * @since 1.0.0
	 * @module
	 */

	let { prop1 }: { prop1: string } = $props();
</script>

<div>{prop1}</div>
