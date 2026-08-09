interface Box {
	out: { a: string; b: number };
}

// an indexed-access right-hand side loses `aliasSymbol`
type Inferred = Box['out'];

declare const seed: Inferred;

/**
 * An inferred (unannotated) return of an alias-lost type: no written return
 * annotation exists, so the flat string prints the expansion and
 * `returnTypeInfo` is absent.
 */
export const make = () => seed;
