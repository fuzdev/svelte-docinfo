/**
 * Description 1.
 */
export class A {
	a: string = 'value';

	/**
	 * Description 2.
	 *
	 * @param b - Description 3
	 * @mutates this - Description 4
	 */
	fn(b: string): void {
		this.a = b;
	}
}
