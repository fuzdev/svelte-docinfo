/**
 * Resolves first, interning the literals in reverse, which sets the
 * checker's internal order for every union below.
 */
export type Z = 'd' | 'c' | 'b' | 'a';

const ab = (): 'b' | 'a' => (Math.random() ? 'a' : 'b');

/**
 * A `.ts` file's JSDoc types annotate nothing, so the checker's order stands.
 * @param {'a' | 'b'} x
 * @returns {'a' | 'b'}
 */
export function fn1(x = ab()) {
	return x;
}

export class C {
	/** @type {'a' | 'b'} */
	a = ab();

	/** @type {'a' | 'b'} */
	get b() {
		return ab();
	}
}
