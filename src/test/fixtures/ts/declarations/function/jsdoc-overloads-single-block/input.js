/**
 * Description 1.
 * @template T
 * @overload
 * @param {T} a - Description 2
 * @returns {T} Description 3
 * @overload
 * @param {number} a - Description 4
 * @param {string} [b] - Description 5
 * @returns {number} Description 6
 * @deprecated
 */
export function fn1(
	// @ts-expect-error - a block of overloads types no implementation parameter
	a,
	// @ts-expect-error - a block of overloads types no implementation parameter
	b
) {
	return b === undefined ? a : 0;
}

/**
 * @overload
 * @param {string} a
 * @returns {string}
 */
/**
 * Description 1.
 * @overload
 * @param {number} a - Description 2
 * @returns {number}
 * @overload
 * @param {boolean} a - Description 3
 * @returns {boolean}
 */
/**
 * @param {string | number | boolean} a
 * @returns {string | number | boolean}
 */
export function fn2(a) {
	return a;
}
