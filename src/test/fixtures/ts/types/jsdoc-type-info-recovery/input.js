const a = { b: /** @type {'a' | 'b'} */ ('a'), c: { d: 1 } };

/**
 * An indexed-access right-hand side loses `aliasSymbol`, and `@nodocs`
 * keeps it out of the alias registry: only the written channel names it.
 * @typedef {typeof a['b']} A
 * @nodocs
 */

/**
 * @typedef {typeof a['c']} B
 * @nodocs
 */

/**
 * @param {A} x
 * @param {B} [y]
 * @returns {B | undefined}
 */
export function fn1(x, y) {
	void x;
	return y;
}

/** @type {A} */
export const b = 'a';

/** @type {B | null} */
export const c = null;

export class C {
	/** @type {A} */
	a = 'a';

	/** @returns {B} */
	get b() {
		return a.c;
	}

	/** @type {B} */
	get c() {
		return a.c;
	}

	/** @param {A} x */
	set d(x) {
		void x;
	}
}
