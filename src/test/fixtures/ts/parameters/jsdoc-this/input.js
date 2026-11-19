export class A {
	a = 1;
}

/**
 * @this {A}
 * @param {number} a
 * @returns {number}
 */
export function fn(a) {
	return this.a + a;
}
