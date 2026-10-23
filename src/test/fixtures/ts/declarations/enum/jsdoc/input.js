/**
 * Description 1.
 * @enum {string}
 */
export const A = {
	/** Description 2 */
	a: 'a',
	b: 'b'
};

/** @enum {number} */
export const B = { a: 0, b: 1 };

/** @enum {string} */
export const C = 'c';

/** @enum {string} */
export const D = ['d'];

/** @param {A} x */
export const fn = (x) => x;

// the harness loads no lib, so `Object.freeze` types as `any` and F lists no
// members here; with a lib it keeps its local `f`
/** @enum {string} */
export const F = Object.freeze({
	/** Description 3 */
	f: 'f'
});

const g = {
	/** Description 4 */
	g: 'g'
};
/** @enum {string} */
export const G = { ...g, h: 'h' };
