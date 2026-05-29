/**
 * A class with only public members.
 */
export class A {
	a: string;
	b: number;
	readonly c: number;
	static d: number = 0;

	constructor(a: string, b: number) {
		this.a = a;
		this.b = b;
		this.c = A.d++;
	}

	/** Description 1 */
	fn1(): string {
		return `${this.a} ${this.b}`;
	}

	/** Description 2 */
	static fn2(a: string): A {
		return new A(a, 0);
	}
}
