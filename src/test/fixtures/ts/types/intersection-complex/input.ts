/**
 * Complex intersection types.
 */
type B = {a: string};
type C = {b: number};
type D = {c: boolean};

export type A = B & C & D & {d: Array<string>};
