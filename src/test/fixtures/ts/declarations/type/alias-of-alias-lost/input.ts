interface Box {
	out: { a: string };
}

// an indexed-access right-hand side loses `aliasSymbol`
type Inferred = Box['out'];

/**
 * An alias over an alias-lost alias is itself lost — the flat string prints
 * the expansion, `members` carries the structure, and the tree recovers the
 * written right-hand-side name.
 */
export type AliasOfLost = Inferred;
