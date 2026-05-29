/**
 * An abstract class with abstract methods.
 */
export abstract class A {
	a: string;

	constructor(a: string) {
		this.a = a;
	}

	/** Description 1 */
	abstract fn1(): void;

	/** Description 2 */
	abstract fn2(a: number): string;

	/** Description 3 */
	fn3(): string {
		return this.a;
	}
}
