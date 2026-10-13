<svelte:options runes={false} />

<script>
	/** @type {string} */
	export let a;
	/**
	 * Description 1
	 *
	 * @type {number}
	 * @deprecated Description 2
	 */
	export let b = 1;
	export let c;
	export let d = 'value';
	/** @type {'a' | 'b' | undefined} */
	export let e = undefined;
	/** Description 3 */
	export let f = { a: 1 };
</script>

<div>{a} {b} {c} {d} {e} {f.a}</div>
