/**
 * The TypeScript twin of `jsdoc-property-docs`: braced parents in a `.ts` file,
 * plus the unbraced form, which checkJs rejects in a `.js` file.
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
 * @param d - Description 10
 * @param {string} d.e - Description 11
 * @param d.f.g - Description 12
 */
export function fn(
	a: { b: string; c: { d: number }; e?: string },
	b: { c: string },
	c: Array<{ d: string }>,
	d: { e: string; f: { g: boolean } }
): void {
	console.log(a, b, c, d);
}
