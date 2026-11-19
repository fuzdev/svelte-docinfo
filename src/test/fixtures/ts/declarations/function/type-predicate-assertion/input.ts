export class A {
	a = 1;
	fn1(): this is B {
		return true;
	}
	fn2(): asserts this is B {}
}

export class B extends A {
	b = 1;
}

export function fn1(a: unknown): asserts a is A {
	if (!(a instanceof A)) throw new Error();
}

export function fn2(a: unknown): asserts a {
	if (!a) throw new Error();
}

export const fn3 = (a: unknown): a is A | B | null => a === null || a instanceof A;

export function fn4(a: string): a is 'a';
export function fn4(a: number): boolean;
export function fn4(a: string | number): boolean {
	return a === 'a';
}

export interface C {
	fn1: (a: unknown) => a is A;
	fn2(a: unknown): asserts a is A;
}
