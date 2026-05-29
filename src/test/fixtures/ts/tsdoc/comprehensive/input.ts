/**
 * Description.
 *
 * Additional description line.
 *
 * @param a - Description 1
 * @param b - Description 2
 * @returns Description 3
 * @throws TypeError - Description 4
 * @throws RangeError - Description 5
 * @example
 * const result = fn('value', {c: true});
 * @deprecated Description 6
 * @see {@link https://fuz.dev}
 * @see fn1
 * @since 1.0.0
 * @mutates b - Description 7
 */
export function fn(a: string, b: {c?: boolean}): string {
	b.c = !!b.c;
	return a.toUpperCase();
}
