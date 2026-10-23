/**
 * Description 1.
 * @overload
 * @param {string} a - Description 2
 * @returns {string} Description 3
 * @example
 * fn1('a');
 * @see https://fuz.dev
 */
/**
 * Description 4.
 * @overload
 * @param {number} a - Description 5
 * @returns {number} Description 6
 * @since 1.0.0
 * @deprecated
 */
/**
 * Description 7.
 * @param {string | number} a - Description 8
 * @returns {string | number} Description 9
 * @example
 * fn1(1);
 * @nodocs
 */
export function fn1(a) {
	return a;
}

/**
 * Description 1.
 * @overload
 * @param {string} a - Description 2
 * @param {number} [b] - Description 3
 * @param {boolean=} c - Description 4
 * @param {number} [d=0] - Description 5
 * @returns {void}
 */
/**
 * Description 6.
 * @overload
 * @param {...string} rest - Description 7
 * @returns {void}
 */
/**
 * @param {...any} args
 */
export function fn2(...args) {
	console.log(args);
}

/**
 * Description 1.
 * @template T
 * @overload
 * @param {T} a
 * @returns {T}
 */
/**
 * Description 2.
 * @template {string} U
 * @template [V=number]
 * @overload
 * @param {U} a
 * @param {V} b
 * @returns {[U, V]}
 */
/**
 * @template W
 * @param {W} a
 * @param {unknown} [b]
 * @returns {unknown}
 */
export function fn3(a, b) {
	return b === undefined ? a : [a, b];
}

/**
 * Description 1.
 * @overload
 * @param {string} a - Description 2
 * @returns {string}
 */
/**
 * Description 3.
 * @overload
 * @param {number} a - Description 4
 * @returns {number}
 */
/**
 * @param {string | number} a
 * @returns {string | number}
 */
export const fn4 = (a) => a;

/**
 * Description 1.
 * @overload
 * @param {string} a - Description 2
 * @returns {string}
 */
/**
 * @param {string} a
 * @returns {string}
 */
export function fn5(a) {
	return a;
}

/**
 * @overload
 * @param {string} a
 * @returns {string}
 */
/**
 * @overload
 * @param {number} a
 * @returns {number}
 */
/**
 * Description 1.
 * @param {string | number} a - Description 2
 * @returns {string | number}
 */
export function fn6(a) {
	return a;
}

/**
 * @overload
 * @param {string} a
 * @returns {string}
 */
/**
 * @overload
 * @param {number} a
 * @returns {number}
 * @deprecated
 */
/**
 * @param {string | number} a
 * @returns {string | number}
 */
export function fn7(a) {
	return a;
}

/**
 * Description 1.
 * @overload
 * @param {string} a
 * @returns {string}
 */
/**
 * Description 1.
 * @overload
 * @param {number} a
 * @returns {number}
 * @deprecated
 */
/**
 * @param {string | number} a
 * @returns {string | number}
 */
export function fn8(a) {
	return a;
}
