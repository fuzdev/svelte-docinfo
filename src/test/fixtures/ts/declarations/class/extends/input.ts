/**
 * A class that extends another class.
 */
class B {
	a: string;
	constructor(a: string) {
		this.a = a;
	}
}

export class A extends B {
	b: number;

	constructor(a: string, b: number) {
		super(a);
		this.b = b;
	}

	/** Description 1 */
	fn1(): string {
		return `${this.a} ${this.b}`;
	}
}
