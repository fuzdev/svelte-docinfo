/**
 * An interface with construct signatures.
 */
export interface A {
	/** Description 1 */
	new (a: string): { b: number };
	/** Description 2 */
	new (a: number): { b: string };
}
