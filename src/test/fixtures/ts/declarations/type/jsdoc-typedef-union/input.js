/** @type {'a'} */
export const a = 'a';

/**
 * Description 1.
 * @typedef {'b' | 'a' | null} A
 */

/** @type {A} */
export let b = 'b';

/**
 * @param {A} x
 * @returns {A}
 */
export const fn = (x) => x;
