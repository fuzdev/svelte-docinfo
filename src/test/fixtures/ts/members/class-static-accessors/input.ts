/**
 * A class with static accessors.
 */
export class A {
	private static _config: string = 'default';

	/** Description 1 */
	static get config(): string {
		return A._config;
	}

	/** Description 2 */
	static set config(value: string) {
		A._config = value;
	}

	/** Description 3 */
	static get readonly_value(): number {
		return 42;
	}
}
