interface B {
	/** Description 1 */
	(a: string): number;
	new (a: string): B;
	[key: string]: unknown;
	b: string;
}

type C = B & { c: number };

/**
 * A named base supplying first keeps its signatures, though the computed
 * entry reaches them too.
 */
export interface A1 extends B, C {}

/**
 * A computed entry supplying first contributes the base's signatures, each
 * once.
 */
export interface A2 extends C, B {}
