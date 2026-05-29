/**
 * A conditional type.
 */
export type A<T> = T extends string ? 'a' : 'b';
