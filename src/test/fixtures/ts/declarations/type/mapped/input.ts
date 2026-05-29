/**
 * A mapped type.
 */
type B = {a: string; b: number; c: boolean};

export type A = {[K in keyof B]: Array<B[K]>};
