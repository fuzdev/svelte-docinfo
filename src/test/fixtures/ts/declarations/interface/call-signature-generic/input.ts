/**
 * An interface with generic call signatures.
 */
export interface A {
	/** Description 1 */
	<T>(a: T): T;
	/** Description 2 */
	<T, U>(a: T, b: U): [T, U];
}
