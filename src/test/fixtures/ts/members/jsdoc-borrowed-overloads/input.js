/**
 * Description 1.
 * @overload
 * @param {string} a
 * @returns {string}
 * @example
 * fn1('a');
 */
/**
 * Description 2.
 * @overload
 * @param {number} a
 * @returns {number}
 * @example
 * fn1(1);
 */
/**
 * @param {string | number} a
 */
export function fn1(a) {
	return a;
}

/**
 * @typedef {object} A
 * @property {typeof fn1} a - Description 3
 */

/**
 * @typedef {object} B
 * @property {typeof fn1} a - Description 1.
 */
