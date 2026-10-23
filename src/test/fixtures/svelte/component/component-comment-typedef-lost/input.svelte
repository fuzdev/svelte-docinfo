<!--
	@component
	Description 1.
	@typedef {A['a']} B
-->

<script module>
	/** @typedef {{a: string | {b: number}}} A */

	/** @type {A['a']} */
	export const a = { b: 1 };
</script>
