interface Box {
	out: { a: string; b: number };
}

// an indexed-access right-hand side loses `aliasSymbol`
type Inferred = Box['out'];

interface UBox {
	u: 'x' | { y: number };
}

// an alias-lost union — recovers as a reference instead of expanding
type LostUnion = UBox['u'];

/**
 * Return and parameter recovery: the alias-lost object as a return-union
 * member and a parameter, the alias-lost union as an optional parameter
 * (recovery composes with the optional-widening strip). Lib-referencing
 * shapes (`Promise<Inferred>`) are unit-tested instead — this harness runs
 * `noResolve` with no lib, so lib generics don't instantiate here.
 */
export const combine = (base: Inferred, extra?: LostUnion): Inferred | undefined => {
	void extra;
	return base;
};
