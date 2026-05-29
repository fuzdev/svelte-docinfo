/**
 * An interface with overloaded and generic method signatures.
 */
export interface A {
	/** Description 1 */
	fn1(a: string): void;
	/** Description 2 */
	fn1(a: number): void;
	/** Description 3 */
	fn2<T>(a: T): T;
}
