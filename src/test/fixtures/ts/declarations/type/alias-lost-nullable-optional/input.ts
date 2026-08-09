interface NBox {
	n: { a: string } | null;
}

/**
 * A null-bearing alias-lost union at an optional position: the optional
 * widening flattens `LostNullable | undefined` into one union, so the walk
 * never sees the two-member union the written name maps — the members
 * expand instead of recovering.
 */
export type NullableHolder = {
	maybe?: LostNullable;
};

// an alias-lost nullable union — the indexed-access right-hand side loses
// `aliasSymbol`; exported below the subject so the harness's first-exported
// walk still picks `NullableHolder`
export type LostNullable = NBox['n'];
