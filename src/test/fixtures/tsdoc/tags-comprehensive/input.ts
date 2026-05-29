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
 * const a = fn('value', {c: true});
 * @deprecated Description 6
 * @see {@link https://fuz.dev}
 * @since 1.0.0
 */
export function fn(a: string, b: {c?: boolean}) {
	if (typeof a !== 'string') {
		throw new TypeError('Description 4');
	}
	if (a.length > 100) {
		throw new RangeError('Description 5');
	}
	b.c = !!b.c;
	return a.toUpperCase();
}
