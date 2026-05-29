export class A {
	/** Description 1 */
	fn1(a: string): string;
	fn1(a: number): number;
	fn1(a: string | number): string | number {
		return a;
	}
}
