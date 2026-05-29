export class A {
	a: string | number;

	constructor(a: string);
	constructor(a: number);
	constructor(a: string | number) {
		this.a = a;
	}

	fn1(a: string): string;
	fn1(a: number): number;
	fn1(a: string | number): string | number {
		return a;
	}
}
