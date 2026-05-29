/**
 * A function with overloads.
 *
 * @param a - Description 1
 * @returns Description 2
 */
export function fn(a: string): string;
export function fn(a: number): number;
export function fn(a: string | number): string | number {
	return a;
}
