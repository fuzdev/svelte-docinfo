// @ts-nocheck - a `@template` after `@overload` is a JSDoc parse error

/**
 * Description 1.
 * @overload
 * @template T
 * @param {T} a - Description 2
 * @returns {T}
 */
/**
 * Description 3.
 * @overload
 * @param {number} a
 * @returns {number}
 */
/**
 * @param {unknown} a
 * @returns {unknown}
 */
export function fn1(a) {
	return a;
}

/**
 * Description 1.
 * @overload
 * @param {string} a - Description 2
 * @template T
 * @returns {string}
 */
/**
 * Description 3.
 * @overload
 * @param {number} a
 * @returns {number}
 */
/**
 * @param {string | number} a
 * @returns {string | number}
 */
export function fn2(a) {
	return a;
}
