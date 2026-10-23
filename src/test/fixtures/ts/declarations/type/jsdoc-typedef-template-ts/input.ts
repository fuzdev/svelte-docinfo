/**
 * Description 1.
 */
export type A<T, U extends string = 'a'> = { a: T; b: U };

export type B<T> = (a: T) => T;

export type C<T extends object> = {
	/** Description 2 */
	a: T;
};
