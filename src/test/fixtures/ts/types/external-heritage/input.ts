import type { B } from 'extpkg';

/** Description 1 */
export interface A extends B {
	/** Description 2 */
	a1: string;
}

/** Description 3 */
export interface C extends A {
	c1: number;
}
