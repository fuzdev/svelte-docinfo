export const fn1 = <const T extends readonly [unknown]>(a: T): T => a;

export function fn2<const T, U>(a: T, b: U): [T, U] {
	return [a, b];
}

export interface A<in T, out U, in out V> {
	a: (x: T) => U;
	b: (x: V) => V;
}

export class B<const in out T> {
	a: (x: T) => T = (x) => x;
}

export interface C {
	fn<const T>(a: T): T;
}
