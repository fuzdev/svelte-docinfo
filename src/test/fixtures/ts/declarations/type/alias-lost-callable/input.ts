interface FBox {
	f: (x: string) => { a: string };
}

/**
 * An alias-lost callable: a callable property projects as a function member
 * (signature fields — callability stays the classification, so no recovery
 * there), while inside a union the callable branch's recovery consult emits
 * `{kind: 'reference', name: 'LostFn'}` instead of a terminal function node.
 */
export type CallableHolder = {
	/** Direct callable property — projects as a function member. */
	direct: LostFn;
	/** Nullable callable — the union member recovers the registered name. */
	handler: LostFn | null;
};

// an alias-lost function type — the indexed-access right-hand side loses
// `aliasSymbol`; exported below the subject so the harness's first-exported
// walk still picks `CallableHolder`
export type LostFn = FBox['f'];
