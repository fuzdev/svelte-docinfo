/**
 * Resolves first, interning the literals in reverse, which sets the
 * checker's internal order for every union below.
 * @typedef {'d' | 'c' | 'b' | 'a'} Z
 */

/** @type {'a' | 'b' | 'c' | 'd'} */
export const a = 'a';

/**
 * @param {'a' | 'b'} x
 * @param {('a' | 'c')=} y
 * @param {'b' | 'd'} [z]
 * @returns {'a' | 'c' | 'b'}
 */
export const fn1 = (x, y, z) => {
	void y;
	void z;
	return x;
};

export class C {
	/** @type {'a' | 'c' | null} */
	a = null;
}

/**
 * @overload
 * @param {'a' | 'b'} x
 * @returns {'a' | 'c' | 'b'}
 */
/**
 * @overload
 * @param {'b' | 'd'} x
 * @param {('a' | 'c')=} y
 * @returns {'b' | 'd'}
 */
/**
 * @param {any} x
 * @param {any} [y]
 * @returns {any}
 */
export function fn2(x, y) {
	void y;
	return x;
}
