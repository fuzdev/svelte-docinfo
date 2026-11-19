export interface A {
	a: string;
	b: number;
}

export const a = { a: 1, b: 'b' };

export type B<T> = { [K in keyof T]: T[K] };

export class C<T = unknown, U = string> {
	t!: T;
	u!: U;
}

export class D extends C<typeof a> {}

export interface E extends C<A['a'], keyof A> {}

export class F extends C<B<A>> {}

export function fn1<T extends keyof A>(t: T): T {
	return t;
}

export function fn2<T extends C<A>, U extends B<T> = B<T>>(t: T, u: U): U {
	return t && u;
}

export type G = 'a' | 'b';

export function fn3<T extends G = G>(t: T): T {
	return t;
}

export interface H {
	h: { a: string };
}

export type I<T extends H> = T['h'];

export function fn4<T extends I<H>>(t: T): T {
	return t;
}

type J = I<H>;

export type { J as K };

export interface L extends J {}

export type M = (a: string) => void;

export interface N {
	(a: string): void;
}

export interface O extends M, N {}

export function fn5<T extends C<typeof a>[], U extends readonly C<keyof A>[]>(t: T, u: U): U {
	return t && u;
}

export function fn6<T extends import('./input.ts').C<A>>(t: T): T {
	return t;
}

/**
 * @throws {C<typeof a>} Description 1
 */
export function fn7(): void {}

export type P<T> = keyof T & string;

export function fn8<T extends P<A>>(t: T): T {
	return t;
}
