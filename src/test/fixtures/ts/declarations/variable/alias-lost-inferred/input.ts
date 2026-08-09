interface Box {
	out: { a: string; b: number };
}

// an indexed-access right-hand side loses `aliasSymbol`
type Inferred = Box['out'];

const seed: Inferred = { a: 'x', b: 1 };

/**
 * An unannotated variable of an alias-lost type: with no written annotation
 * to recover a name from, the flat string prints the expansion and the tree
 * is absent (an object root has no structure beyond the flat string).
 */
export const derived = seed;
