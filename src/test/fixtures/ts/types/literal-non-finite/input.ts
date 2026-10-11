/**
 * Number literal types with no finite value, beside a bigint and a finite one.
 */
export type A = 1e999 | -1e999 | 1n | 1;

// @ts-expect-error erasableSyntaxOnly
export enum B {
	a = 1 / 0,
	b = -1 / 0,
	c = 0 / 0,
	d = 1
}

export type C = {
	a?: B;
	b: 1e999;
};
