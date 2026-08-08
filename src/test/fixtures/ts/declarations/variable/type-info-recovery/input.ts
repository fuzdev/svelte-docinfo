interface UBox {
	u: 'x' | { y: number };
}

// an alias-lost union — an indexed-access right-hand side loses `aliasSymbol`
type LostUnion = UBox['u'];

/**
 * Root recovery: the flat string prints the expansion, the tree carries the
 * recovered bare reference (the relaxed absence contract).
 */
export const seed: LostUnion = 'x';
