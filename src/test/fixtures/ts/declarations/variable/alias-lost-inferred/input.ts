interface Box {
	out: { a: string; b: number };
}

const seed: Inferred = { a: 'x', b: 1 };

/**
 * An unannotated variable of an alias-lost type: with no written annotation
 * to recover a name from, the flat string prints the expansion and the tree
 * is absent (an object root has no structure beyond the flat string).
 */
export const derived = seed;

// an indexed-access right-hand side loses `aliasSymbol`; exported below the
// subject so the harness's first-exported walk still picks `derived`
export type Inferred = Box['out'];
