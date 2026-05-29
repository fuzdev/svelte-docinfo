/**
 * A function with destructured array parameters.
 *
 * @param a - Description 1
 * @returns Description 2
 */
export function fn([a, b]: [string, number]): string {
	return a + b;
}
