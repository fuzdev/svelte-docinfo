/**
 * Description.
 *
 * @param a - Description 1
 * @param b - Description 2
 * @mutates a - Description 3
 * @mutates b - Description 4
 */
export function fn(a: any, b: any) {
	a.ready = true;
	b.initialized = Date.now();
}
