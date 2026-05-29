/**
 * Complex union types.
 */
type B = {a: string};
type C = {b: number};

export type A = string | number | (B & C) | Array<string | number>;
