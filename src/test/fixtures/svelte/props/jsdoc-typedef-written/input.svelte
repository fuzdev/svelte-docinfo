<script>
	// resolves first, interning the literals in reverse, which sets the
	// checker's internal order for the union below
	const z = /** @type {'d' | 'c' | 'b' | 'a'} */ ('a');
	const a = { b: { c: 1 } };

	/**
	 * An indexed-access right-hand side loses `aliasSymbol`; an instance
	 * script exports nothing, so only the written channel names it.
	 * @typedef {typeof a['b']} A
	 */

	/**
	 * @typedef {object} Props
	 * @property {A} prop1
	 * @property {'a' | 'b' | 'c' | 'd'} [prop2]
	 */

	/** @type {Props} */
	let { prop1, prop2 = z } = $props();
</script>

<p>{prop1.c}{prop2}</p>
