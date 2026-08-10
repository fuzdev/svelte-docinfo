<script lang="ts">
	import type { HTMLButtonAttributes, HTMLButtonAttributes as ButtonAttrs } from 'svelte/elements';

	/** Reached under the local rename. */
	interface Renamed extends ButtonAttrs {
		/** Description 1 */
		prop1: string;
	}

	/** Reached under the exported name — the two collapse to one contributor. */
	interface Plain extends HTMLButtonAttributes {
		/** Description 2 */
		prop2?: number;
	}

	type Props = Renamed & Plain;

	const { prop1, prop2, ...rest }: Props = $props();
</script>

<button {...rest}>{prop1}{prop2}</button>
