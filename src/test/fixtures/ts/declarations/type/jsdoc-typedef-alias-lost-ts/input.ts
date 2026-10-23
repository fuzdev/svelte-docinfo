export type A = {
	b: { a: string };
};

/**
 * An indexed-access right-hand side loses `aliasSymbol`.
 */
export type B = A['b'];

export type C = B;
