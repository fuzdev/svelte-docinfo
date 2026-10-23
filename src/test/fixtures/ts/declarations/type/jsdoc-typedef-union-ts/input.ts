export const a: 'a' = 'a';

/**
 * Description 1.
 */
export type A = 'b' | 'a' | null;

export let b: A = 'b';

export const fn = (x: A): A => x;
