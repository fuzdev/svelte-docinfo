interface FBox {
	f: (x: string) => { a: string };
}

/**
 * An alias-lost callable: a callable property projects as a function member
 * (signature fields, no `typeInfo`), and inside a union the callable branch
 * emits a terminal function node — the written name never recovers on
 * either path.
 */
export type CallableHolder = {
	/** Direct callable property — projects as a function member. */
	direct: LostFn;
	/** Nullable callable — the union member stays a terminal function node. */
	handler: LostFn | null;
};

// an alias-lost function type — the indexed-access right-hand side loses
// `aliasSymbol`; exported below the subject so the harness's first-exported
// walk still picks `CallableHolder`
export type LostFn = FBox['f'];
