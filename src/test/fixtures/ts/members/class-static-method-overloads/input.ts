export class A {
	static fn1(a: string): string;
	static fn1(a: number): number;
	static fn1(a: string | number): string | number {
		return a;
	}
}
