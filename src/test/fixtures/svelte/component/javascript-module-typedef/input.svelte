<script module>
	/**
	 * Description 1.
	 * @typedef {object} A
	 * @property {string} a - Description 2
	 */
	/** @typedef {'d' | 'c'} B */

	/** @typedef {number} C */
	export const c = 1;

	/** Description 3. */
	export const D = { d: 1 };
	/**
	 * Description 4.
	 * @typedef {typeof D} D
	 */
</script>

<script>
	/** @type {{a: A}} */
	let { a } = $props();
</script>

<p>{a.a}</p>
