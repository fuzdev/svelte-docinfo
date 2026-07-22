/**
 * Utility type combinations.
 */
type B = { a: string; b: number; c: boolean };

export type A = {
	a: Pick<B, 'a' | 'b'>;
	b: Omit<B, 'c'>;
	c: Partial<B>;
	d: Required<Partial<B>>;
	e: Readonly<B>;
	f: Record<string, number>;
	g: Pick<Partial<B>, 'a'>;
};
