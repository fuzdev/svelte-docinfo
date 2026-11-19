export interface A {
	a: string;
	b: number;
}

export const a = { a: 1, b: 'b' };

export type B = { c: 'x' } | { c: 'y' };

export class C<T = string> {
	t!: T;
}

export interface D {
	d1: keyof A;
	d2: typeof a;
	d3: A['a'];
	d4: B & { e: 1 };
	d5: C;
	d6: C<number>;
	d7?: keyof A;
}

export const b: keyof A = 'a';

export function fn1(x: unknown): x is B & { e: 1 } {
	return x !== null;
}

export function fn2(x: typeof a, y: C<string>): keyof A {
	return x && y ? 'a' : 'b';
}
