/**
 * Description 1.
 * @param a
 * @param b
 */
export function fn1<T, K extends string = 'k'>(a: T, b?: K): T {
	void b;
	return a;
}

/**
 * Description 2.
 * @param a
 * @param b
 */
export const fn2 = <T, K extends string = 'k'>(a: T, b?: K): T => {
	void b;
	return a;
};

/**
 * Description 3.
 * @param a
 */
export const fn3 = function <T>(a: T): T {
	return a;
};

/**
 * Description 4.
 */
export class A<T, K extends string = 'k'> {
	a: T | undefined;

	/** @param b */
	constructor(b: K) {
		void b;
	}

	/**
	 * Description 5.
	 * @param a
	 */
	fn1<U extends object>(a: U): U {
		return a;
	}

	/**
	 * Description 7.
	 * @param a
	 */
	fn2(a: string): string;
	fn2<V>(a: V): V;
	fn2<U>(a: U): U {
		return a;
	}
}

/**
 * Description 6.
 */
export const fn4: <T>(a: T) => T = (a) => a;

/**
 * Description 8.
 * @param a
 */
export function fn5(a: string): string;
export function fn5<U>(a: U): U;
export function fn5<T>(a: T): T {
	return a;
}

export type O = { fn: typeof fn1 };

/**
 * Description 9.
 * @overload
 */
export function fn6<T>(a: T): T {
	return a;
}
