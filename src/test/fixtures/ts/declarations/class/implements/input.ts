/**
 * A class that implements an interface.
 */
interface B {
	a: string;
	fn1(): void;
}

export class A implements B {
	a: string;

	constructor(a: string) {
		this.a = a;
	}

	/** Description 1 */
	fn1(): void {
		console.log(this.a);
	}
}
