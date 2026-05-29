/**
 * A generic type with constraints and defaults.
 */
export interface A<T extends object = Record<string, unknown>, E = Error> {
	/** Description 1 */
	a: boolean;
	/** Description 2 */
	b?: T;
	/** Description 3 */
	c?: E;
}
