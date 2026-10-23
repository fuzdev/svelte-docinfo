/**
 * Description 1.
 */
// @ts-expect-error erasableSyntaxOnly
export enum A {
	/** Description 2 */
	a = 'a',
	b = 'b'
}

// @ts-expect-error erasableSyntaxOnly
export enum B {
	a = 0,
	b = 1
}

export const fn = (x: A): A => x;
