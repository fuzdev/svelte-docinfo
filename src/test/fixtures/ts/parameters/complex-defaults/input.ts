/**
 * A function with complex default values.
 *
 * @param a - Description 1
 * @param b - Description 2
 * @param c - Description 3
 * @returns Description 4
 */
export function fn(
	a: {b: string; c: number} = {b: 'value', c: 1},
	b: Array<number> = [1, 2, 3],
	c: string = `template`,
): string {
	return a.b + b.length + c;
}
