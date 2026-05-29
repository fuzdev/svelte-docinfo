/**
 * A function with rest parameters.
 *
 * @param a - Description 1
 * @param b - Description 2
 * @returns Description 3
 */
export function fn(a: string, ...b: Array<number>): string {
	return a + b.join(',');
}
