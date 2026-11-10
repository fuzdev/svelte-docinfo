interface B {
	/** Description 1 */
	a: string;
	b: number;
}

type C = {
	/** Description 2 */
	a: string;
	/** Description 3 */
	c: boolean;
};

type D = {
	/** Description 4 */
	c: boolean;
	d: string;
};

/**
 * A named base keeps its members; the computed entries contribute theirs, the
 * first entry with a name supplying it.
 */
export interface A extends B, C, D {}
