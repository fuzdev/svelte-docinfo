/**
 * A generic function with type constraints.
 *
 * @param a - Description 1
 * @param b - Description 2
 * @returns Description 3
 */
export function fn<T extends {id: number}>(a: Array<T>, b: (x: T) => boolean): T | undefined {
	return a.find(b);
}
