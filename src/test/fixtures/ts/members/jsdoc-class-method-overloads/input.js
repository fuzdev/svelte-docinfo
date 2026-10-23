export class A {
	/**
	 * Description 1.
	 * @overload
	 * @param {string} a - Description 2
	 */
	/**
	 * Description 3.
	 * @overload
	 * @param {number} a - Description 4
	 * @param {boolean} [b] - Description 5
	 */
	/**
	 * Description 6.
	 * @param {string | number} a
	 * @param {boolean} [b]
	 */
	constructor(a, b) {
		console.log(a, b);
	}

	/**
	 * Description 1.
	 * @template T
	 * @overload
	 * @param {T} a - Description 2
	 * @returns {T} Description 3
	 */
	/**
	 * Description 4.
	 * @overload
	 * @param {number} a - Description 5
	 * @returns {number} Description 6
	 * @example
	 * new A('a').fn1(1);
	 */
	/**
	 * Description 7.
	 * @param {unknown} a
	 * @returns {unknown}
	 */
	fn1(a) {
		return a;
	}

	/**
	 * Description 1.
	 * @overload
	 * @param {string} a
	 * @returns {string}
	 * @overload
	 * @param {...number} rest - Description 2
	 * @returns {number}
	 */
	static fn2(
		// @ts-expect-error - a block of overloads types no implementation parameter
		...args
	) {
		return args[0];
	}

	/**
	 * Description 1.
	 * @overload
	 * @returns {string}
	 */
	/**
	 * Description 2.
	 * @returns {string}
	 */
	get prop1() {
		return '';
	}

	/**
	 * Description 1.
	 * @overload
	 * @param {string} value
	 */
	/**
	 * Description 2.
	 * @param {string} value - Description 3
	 */
	set prop1(value) {
		console.log(value);
	}
}
