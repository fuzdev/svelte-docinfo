/**
 * Alias-lost unions written as members of a larger union. The checker
 * flattens a nameless union into the outer one, so the written reference is
 * the only signal left; it recovers as one `reference` member at its written
 * position.
 */
import type { LostD as D } from './dep.ts';

export type A = 's' | 'm';

interface Box {
	a: 'a' | 'b' | { x: number };
	b: 'c' | 'd';
	c: A | 'e';
	d: 'u' | 'v' | undefined;
}

export type LostA = Box['a'];

export type LostB = Box['b'];

// keeps the named sub-union `A` as its own slot
export type LostC = Box['c'];

export type LostU = Box['d'];

// local stand-ins for lib's `Exclude` and `NonNullable` (fixtures are lib-less)
type X<T, U> = T extends U ? never : T;
type Y<T> = T & {};

interface M<T> {
	a: T;
}

export interface B {
	a: LostA | null;
	b?: LostA | null;
	c: LostA | 'z';
	d: 'z' | LostA;
	e: LostA | LostB | null;
	f: D | null;
	g: M<LostA | null>;
	h: [LostA | null, number];
	i: LostC | null;
	// the overlap is absorbed by the reference written first
	j: LostB | 'c' | 'z';
	// the overlap is written first, so the members expand
	k: 'c' | LostB | 'z';
	// `string` absorbs the literals, so the members expand
	l: LostA | string;
	m: LostA | B;
	// the second union shares the first's member set, so it borrows the grouping
	n: [LostB | null, 'c' | 'd' | null];
	// the optional widening strips the lost union's own `undefined`, which a
	// type operator removing it can't be told apart from, so both expand
	o?: LostU | 'z';
	p: LostU | 'z';
	q: X<LostU | 'z', undefined>;
	r: Y<LostU | 'z'>;
}

// an alias right-hand side orders the members at every use
export type C = LostA | null;

export interface E {
	a: C;
	b: M<C>;
}

export const fn = (a: LostA | null): LostB | 'z' => (a === null ? 'z' : 'c');

declare const box: Box;
declare const flag: boolean;

// inferred, so no written reference reaches it: the members expand
export const inferred = flag ? box.a : null;
