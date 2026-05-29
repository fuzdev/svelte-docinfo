/**
 * A function with type predicate.
 *
 * @param a - Description 1
 * @returns Description 2
 */
export function fn(a: unknown): a is string {
	return typeof a === 'string';
}
