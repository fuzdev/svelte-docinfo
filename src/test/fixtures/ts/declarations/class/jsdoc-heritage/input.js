/**
 * @typedef {object} A
 * @property {string} a
 */

/**
 * @typedef {object} B
 * @property {number} b
 */

/** @template T */
export class C {
	/** @type {T | undefined} */
	c = undefined;
}

/**
 * Description 1
 * @extends {C<string>}
 * @implements {A}
 * @implements {B}
 */
export class D extends C {
	a = '';
	b = 1;
}

/** @extends {C<number>} */
export class E {}

/** @implements {A} */
export class F {
	a = '';
}
