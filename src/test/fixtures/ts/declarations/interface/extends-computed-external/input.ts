import type { C, D } from 'extpkg';
import type { Omit, Partial } from 'utilpkg';

/**
 * A computed type over an external bag drops the bag's members, labeled in
 * `externalTypes`.
 */
export interface A1 extends Omit<C, 'c2'> {
	a: string;
}

/** The type-alias twin of `A1`, documenting the same members and labels. */
export type A2 = Omit<C, 'c2'> & { a: string };

/** A mapped type's synthesized index signature stays, as on an alias. */
export interface A3 extends Partial<D> {}
