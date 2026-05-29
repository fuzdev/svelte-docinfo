/**
 * A class with private fields that should be filtered out.
 */
export class A {
	// Private fields (should NOT appear in output)
	#a: number = 0;
	#b: number;

	// Private keyword members (should NOT appear in output)
	private d: string = 'value';

	// Protected members (SHOULD appear in output)
	protected e: boolean = true;
	protected fn5(): number {
		return this.#a + (this.d ? 1 : 0);
	}

	// Public members (SHOULD appear in output)
	readonly c: string;

	// Private constructor (should NOT appear in output)
	private constructor(c: string, b: number = 1) {
		this.c = c;
		this.#b = b;
	}

	static fn0(c: string): A {
		return new A(c);
	}

	/** Description 1 */
	fn1(): number {
		return this.#a;
	}

	/** Description 2 */
	fn2(): void {
		if (this.#a < this.#b) {
			this.#a++;
		}
	}

	/** Description 3 */
	fn3(): void {
		this.#fn();
	}

	// Private method (should NOT appear in output)
	#fn(): void {
		this.#a = 0;
	}
}
