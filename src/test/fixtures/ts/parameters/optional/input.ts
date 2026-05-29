/**
 * A function with optional and default parameters.
 *
 * @param a - Description 1
 * @param b - Description 2
 * @param c - Description 3
 */
export function fn(a: string, b?: number, c: boolean = true): void {
	console.log(a, b, c);
}
