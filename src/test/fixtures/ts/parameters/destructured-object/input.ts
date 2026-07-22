/**
 * A function with destructured object parameters.
 *
 * @param a - Description 1
 * @returns Description 2
 */
export function fn({ a, b }: { a: string; b: number }): string {
	return a + b;
}
