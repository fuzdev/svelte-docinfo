<script>
	/** @import { HTMLButtonAttributes } from 'svelte/elements' */

	/** @type {{prop1?: string} & HTMLButtonAttributes} */
	let { prop1 = 'a', type = 'button', disabled, ...rest } = $props();
</script>

<button {type} {disabled} {...rest}>{prop1}</button>
