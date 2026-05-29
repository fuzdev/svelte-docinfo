/**
 * Description.
 *
 * @param a - Description 1
 * @throws Error - Description 2
 */
export function fn(a: number) {
	if (a < 0) {
		throw new Error('Description 2');
	}
	return a;
}
