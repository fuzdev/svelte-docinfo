export interface A {
	a: number;
}

export interface B<T> {
	b: T;
}

export function fn1<T extends A, U extends B<A> = B<A>, V extends A | B<A> | null = null>(
	a: T,
	b: U,
	c: V
): [T, U, V] {
	return [a, b, c];
}

export type C<T extends keyof A = 'a', U extends string = string> = [T, U];

export class D<T extends [A, B<A>]> {
	a!: T;
}
