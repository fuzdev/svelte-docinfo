/**
 * The TypeScript twin of `jsdoc-optional`: `?` and initializers.
 *
 * @param a - Description 1
 * @param b - Description 2
 * @param c - Description 3
 * @param d - Description 4
 * @param e - Description 5
 * @param f - Description 6
 * @param [g=2] - Description 7
 * @param h - Description 8
 */
export function fn1(
	a: string,
	b?: number,
	c?: number,
	d: number = 0,
	e: string = 'a]',
	f: { b: number } = { b: 1 },
	g: number | undefined = 1,
	...h: Array<boolean>
): void {
	console.log(a, b, c, d, e, f, g, h);
}

/**
 * An initializer followed by a required parameter.
 *
 * @param a - Description 1
 * @param b - Description 2
 */
export function fn2(a: number = 1, b: string): void {
	console.log(a, b);
}

/**
 * A JSDoc bracket default on a parameter with no initializer.
 *
 * @param [a=1] - Description 1
 */
export const fn3 = (a?: number): number | undefined => a;

/**
 * A bracket default on a parameter a caller can't omit is ignored.
 *
 * @param [b=7] - Description 1
 */
export function fn4(b: number): number {
	return b;
}

/**
 * A dotted tag's bracket default never lands on a later destructured parameter.
 *
 * @param first - Description 1
 * @param [first.z=3] - Description 2
 * @param second - Description 3
 */
export function fn5({ x }: { x: number }, { y }?: { y?: number }): void;
export function fn5(a: { x: number }, b?: { y?: number }): void {
	console.log(a, b);
}
