/**
 * A class with various method types.
 */
export class A {
	/** Description 1 */
	fn1(): void {
		this.fn2();
	}

	/** Description 2 */
	private fn2(): void {}

	/** Description 3 */
	protected fn3(): void {}

	/** Description 4 */
	static fn4(): void {}

	/** Description 5 */
	public fn5(): void {}
}
