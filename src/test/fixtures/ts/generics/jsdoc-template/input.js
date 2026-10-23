/**
 * Description 1.
 * @template T
 * @template {string} [K='k']
 * @param {T} a
 * @param {K} [b]
 * @returns {T}
 */
export function fn1(a, b) {
	void b;
	return a;
}

/**
 * Description 2.
 * @template T
 * @template {string} [K='k']
 * @param {T} a
 * @param {K} [b]
 * @returns {T}
 */
export const fn2 = (a, b) => {
	void b;
	return a;
};

/**
 * Description 3.
 * @template T
 * @param {T} a
 * @returns {T}
 */
export const fn3 = function (a) {
	return a;
};

/**
 * Description 4.
 * @template T
 * @template {string} [K='k']
 */
export class A {
	/** @type {T | undefined} */
	a;

	/** @param {K} b */
	constructor(b) {
		void b;
	}

	/**
	 * Description 5.
	 * @template {object} U
	 * @param {U} a
	 * @returns {U}
	 */
	fn1(a) {
		return a;
	}

	/**
	 * Description 7.
	 * @overload
	 * @param {string} a
	 * @returns {string}
	 */
	/**
	 * @template V
	 * @overload
	 * @param {V} a
	 * @returns {V}
	 */
	/**
	 * @template U
	 * @param {U} a
	 * @returns {U}
	 */
	fn2(a) {
		return a;
	}
}

/**
 * Description 6.
 * @type {<T>(a: T) => T}
 */
export const fn4 = (a) => a;

/**
 * Description 8.
 * @overload
 * @param {string} a
 * @returns {string}
 */
/**
 * @template U
 * @overload
 * @param {U} a
 * @returns {U}
 */
/**
 * @template T
 * @param {T} a
 * @returns {T}
 */
export function fn5(a) {
	return a;
}

/** @typedef {{fn: typeof fn1}} O */

/**
 * Description 9.
 * @overload
 * @param {string} a
 * @returns {string}
 */
/**
 * @template T
 * @param {T} a
 * @returns {T}
 */
export const fn6 = (a) => a;
