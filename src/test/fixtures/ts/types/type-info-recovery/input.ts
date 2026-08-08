interface Box {
	out: { a: string; b: number };
}

// an indexed-access right-hand side loses `aliasSymbol` — the checker prints
// the expansion everywhere, and `typeInfo` recovers the written name
type Inferred = Box['out'];

export type Registry = {
	/** Recovers the alias-lost object by its written name. */
	first: Inferred;
	/** Recovery composes with the optional-widening strip. */
	maybe?: Inferred;
	[key: string]: Inferred | undefined;
};
