/**
 * A class with various property modifiers.
 */
export class A {
	a: string;
	private b: number;
	protected c: boolean;
	readonly d: string;
	static e: number = 0;
	public f: boolean;

	constructor(a: string) {
		this.a = a;
		this.b = 1;
		this.c = true;
		this.d = 'value';
		this.f = false;
	}

	fn(): number {
		return this.b;
	}
}
