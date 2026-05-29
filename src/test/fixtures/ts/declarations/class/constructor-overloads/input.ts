/**
 * A class with constructor overloads.
 */
export class A {
	a: string | number;

	constructor(a: string);
	constructor(a: number);
	constructor(a: string | number) {
		this.a = a;
	}

	/** Description 1 */
	fn1(): string {
		return String(this.a);
	}
}
