<script module lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';

	/** Exported for reuse by wrappers. */
	export interface ExportedButtonProps extends HTMLButtonAttributes {
		/** Description 1 */
		label: string;
	}
</script>

<script lang="ts">
	const { label, ...rest }: ExportedButtonProps = $props();
</script>

<button {...rest}>{label}</button>
