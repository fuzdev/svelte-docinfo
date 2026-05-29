/**
 * Description.
 *
 * @param a - Description 1
 * @throws TypeError - Description 2
 * @throws RangeError - Description 3
 * @throws Error - Description 4
 */
export function fn(a: any) {
	if (typeof a !== 'string') {
		throw new TypeError('Description 2');
	}
	if (a.length > 100) {
		throw new RangeError('Description 3');
	}
	if (!a.trim()) {
		throw new Error('Description 4');
	}
	return a;
}
