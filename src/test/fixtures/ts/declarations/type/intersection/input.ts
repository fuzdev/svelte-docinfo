/**
 * An intersection type.
 */
type B = {a: string};
type C = {b: number};

export type A = B & C & {c: boolean};
