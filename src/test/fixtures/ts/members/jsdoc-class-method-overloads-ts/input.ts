export class A {
	/**
	 * Description 1.
	 * @param a - Description 2
	 */
	constructor(a: string);
	/**
	 * Description 3.
	 * @param a - Description 4
	 * @param b - Description 5
	 */
	constructor(a: number, b?: boolean);
	/**
	 * Description 6.
	 */
	constructor(a: string | number, b?: boolean) {
		console.log(a, b);
	}

	/**
	 * Description 1.
	 * @param a - Description 2
	 * @returns Description 3
	 */
	fn1<T>(a: T): T;
	/**
	 * Description 4.
	 * @param a - Description 5
	 * @returns Description 6
	 * @example
	 * new A('a').fn1(1);
	 */
	fn1(a: number): number;
	/**
	 * Description 7.
	 */
	fn1(a: unknown): unknown {
		return a;
	}

	/**
	 * Description 1.
	 */
	static fn2(a: string): string;
	/**
	 * Description 1.
	 * @param rest - Description 2
	 */
	static fn2(...rest: Array<number>): number;
	static fn2(...args: Array<unknown>): unknown {
		return args[0];
	}
}

export interface B {
	/**
	 * Description 1.
	 * @deprecated Description 2
	 */
	fn1(a: number): void;
}
export class B {
	/**
	 * Description 3.
	 * @deprecated Description 4
	 */
	fn1(a: string): void;
	fn1(a: unknown): void {
		console.log(a);
	}
}
