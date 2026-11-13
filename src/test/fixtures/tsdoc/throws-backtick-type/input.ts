/**
 * Description.
 *
 * @param a - Description 1
 * @throws `RangeError` - Description 2
 * @throws `TypeError` Description 3
 * @throws `a.b` Description 4
 * @throws `a` Description 5
 * @throws `SyntaxError`
 *   Description 6
 * @throws `EvalError`
 */
export function fn(a: number) {
	if (a < 0) {
		throw new RangeError('Description 2');
	}
	return a;
}
