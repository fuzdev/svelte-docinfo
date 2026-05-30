/**
 * A class whose method parameters are named after `Object.prototype` keys.
 *
 * Regression: with a plain-object `@param` map these undocumented params would
 * resolve to inherited prototype values (e.g. `Object.prototype.constructor`)
 * instead of `undefined`, producing a non-string `description`.
 */
export class A {
	/** Description 1 */
	fn1(constructor: string, toString: number): void {
		this.fn1(constructor, toString);
	}
}
