/**
 * A class with getter and setter properties.
 */
export class A {
	private _a: string = 'value';

	/** Description 1 */
	get a(): string {
		return this._a;
	}

	/** Description 2 */
	set a(value: string) {
		this._a = value;
	}

	/** Description 3 */
	get b(): number {
		return 1;
	}
}
