/**
 * A function with JSDoc-optional and defaulted parameters.
 *
 * @param {string} a - Description 1
 * @param {number} [b] - Description 2
 * @param {number=} c - Description 3
 * @param {number} [d=0] - Description 4
 * @param {string} [e='a]'] - Description 5
 * @param {{b: number}} [f = { b: 1 }] - Description 6
 * @param {number} [g=2] - Description 7
 */
export function fn1(a, b, c, d, e, f, g = 1) {
	console.log(a, b, c, d, e, f, g);
}

/**
 * An initializer followed by a required parameter.
 *
 * @param {number} a - Description 1
 * @param {string} b - Description 2
 */
export function fn2(a = 1, b) {
	console.log(a, b);
}

/**
 * An arrow function with an initializer and no JSDoc type.
 *
 * @param [a=1] - Description 1
 */
export const fn3 = (a = 1) => a;

/**
 * A bracketed rest parameter stays non-optional.
 *
 * @param {...number} [rest] - Description 1
 */
export function fn4(
	// @ts-expect-error - the bracket makes the rest's type `T[] | undefined`, not an array (`{}` in this lib-less host)
	...rest
) {
	console.log(rest);
}

/**
 * A braced, bracketed object parameter keeps its default beside nested docs.
 *
 * @param {object} [opts={}] - Description 1
 * @param {string} [opts.name] - Description 2
 */
export function fn5(opts) {
	console.log(opts);
}
