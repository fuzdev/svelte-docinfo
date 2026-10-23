/**
 * Resolves first, interning the literals in reverse, which sets the
 * checker's internal order for every union below.
 */
export type Z = 'd' | 'c' | 'b' | 'a';

export const a: 'a' | 'b' | 'c' | 'd' = 'a';

export const fn1 = (x: 'a' | 'b', y?: 'a' | 'c', z?: 'b' | 'd'): 'a' | 'c' | 'b' => {
	void y;
	void z;
	return x;
};

export class C {
	a: 'a' | 'c' | null = null;
}
