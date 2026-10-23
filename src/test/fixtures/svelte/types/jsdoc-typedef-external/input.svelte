<script>
	/** @import {HTMLButtonAttributes} from 'svelte/elements' */
	/** @typedef {HTMLButtonAttributes & {a: string}} A */

	/** @type {A} */
	let { a, ...rest } = $props();
</script>

<button {...rest}>{a}</button>
