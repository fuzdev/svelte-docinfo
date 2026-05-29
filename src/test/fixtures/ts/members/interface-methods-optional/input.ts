/**
 * An interface with optional method signatures.
 */
export interface A {
	/** Description 1 */
	fn1(): void;
	/** Description 2 */
	fn2?(a: string): number;
	/** Description 3 */
	fn3?<T>(a: T): T;
}
