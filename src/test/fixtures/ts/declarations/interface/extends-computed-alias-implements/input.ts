type B = {
	/** Description 1 */
	a: string;
};

/** Description 2 */
export interface A extends B {}

/** An alias over the interface lists the interface's members once. */
export type C = A;

/** A class implementing the interface documents its own members only. */
export class D implements A {
	a = '';
}
