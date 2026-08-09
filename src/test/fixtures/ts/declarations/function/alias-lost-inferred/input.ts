interface Box {
	out: { a: string; b: number };
}

declare const seed: Inferred;

/**
 * An inferred (unannotated) return of an alias-lost type: no written return
 * annotation exists, so the flat string prints the expansion while
 * `returnTypeInfo` recovers the exported alias's name through the registry.
 */
export const make = () => seed;

// an indexed-access right-hand side loses `aliasSymbol`; exported below the
// subject so the harness's first-exported walk still picks `make`
export type Inferred = Box['out'];
