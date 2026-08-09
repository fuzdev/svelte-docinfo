interface NBox {
	n: { a: string } | null;
}

/**
 * A null-bearing alias-lost union at an optional position: the optional
 * widening flattens `LostNullable | undefined` into one union the identity
 * lookup can never match — the registry's member-set side index recovers the
 * name from the surviving members instead.
 */
export type NullableHolder = {
	maybe?: LostNullable;
};

// an alias-lost nullable union — the indexed-access right-hand side loses
// `aliasSymbol`; exported below the subject so the harness's first-exported
// walk still picks `NullableHolder`
export type LostNullable = NBox['n'];
