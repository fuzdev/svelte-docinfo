/**
 * A generic class with type parameters.
 */
export class A<T, U = string> {
	a: T;
	b: U;

	constructor(a: T, b: U) {
		this.a = a;
		this.b = b;
	}

	/** Description 1 */
	fn1(): T {
		return this.a;
	}

	/** Description 2 */
	fn2(a: T): void {
		this.a = a;
	}
}
