/**
 * A class with optional method declarations — the class-side mirror of the
 * `interface-methods-optional` fixture. An optional method resolves to a union
 * with `undefined`, which reports no call signatures, so the site strips the
 * widening before querying; without it these ship with no signature fields.
 */
export class A {
	/** Description 1 */
	fn1(): void {}

	/** Description 2 */
	fn2?(a: string): number {
		return a.length;
	}

	// the baseline records that a generic class method carries its type
	// parameters only inside `typeSignature`, where the interface-method path
	// also emits `genericParams` — an asymmetry the class site doesn't share,
	// independent of optionality
	/** Description 3 */
	fn3?<T>(a: T): T {
		return a;
	}

	/** Description 4 — declared, no implementation */
	fn4?(): void;

	/** Description 5 — a function-typed field stays `kind: 'variable'` */
	fn5?: () => void;
}
