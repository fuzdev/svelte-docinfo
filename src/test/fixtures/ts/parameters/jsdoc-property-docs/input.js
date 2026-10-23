/**
 * Object-parameter properties nested under braced `{object}` parents.
 *
 * @param {object} a - Description 1
 * @param {string} a.b - Description 2
 * @param {object} a.c - Description 3
 * @param {number} a.c.d - Description 4
 * @param {string} [a.e] - Description 5
 * @param {Object} b - Description 6
 * @param {string} b.c - Description 7
 * @param {object[]} c - Description 8
 * @param {string} c[].d - Description 9
 */
export function fn(a, b, c) {
	console.log(a, b, c);
}
