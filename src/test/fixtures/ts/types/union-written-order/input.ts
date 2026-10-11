/**
 * Union members in written order. `B` resolves first, interning the literals
 * in reverse, which sets the checker's internal order for every union below.
 */
import type { B } from './dep.ts';

export type Z = B;

export type A = 'a' | 'b' | 'c' | 'd';

export const a: 'a' | 'b' | 'c' | 'd' = 'a';

export const b = (a: A): A => a;

export const c = (a: 'b' | 'a'): ['a' | 'c' | 'b'] => [a];

interface M<T> {
	a: T;
}

export interface C {
	a?: 'a' | 'b' | null | 'c';
	b: M<'c' | 'a'>;
}

// the return type is inferred, so no written union node reaches it: the
// checker's order
export const d = (a: 'a' | 'b') => a;
