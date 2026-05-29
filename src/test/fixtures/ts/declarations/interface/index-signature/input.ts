/**
 * An interface with index signatures.
 */
export interface A {
	/** Description 1 */
	a: string;
	/** Description 2 */
	[key: string]: string | number;
	/** Description 3 */
	[index: number]: string;
}
