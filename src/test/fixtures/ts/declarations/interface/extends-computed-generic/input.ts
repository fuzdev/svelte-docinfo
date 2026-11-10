type B<T> = {
	/** Description 1 */
	a: T;
	b?: T | null;
};

/** Description 2 */
export interface A<T> extends B<T> {
	c: T;
}

/** Description 3 */
export interface C extends B<string> {}
