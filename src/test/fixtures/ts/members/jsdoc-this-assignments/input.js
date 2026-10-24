export class A {
	/** Description 1 */
	a = 1;
	#b = 2;

	/** @param {number} x */
	constructor(x) {
		this.a = x;
		this.#b = x;
		/**
		 * Description 2
		 * @type {number}
		 */
		this.c = x;
		/** @private */
		this.d = 1;
		/** @protected @readonly */
		this.e = 'a';
		/** @type {string | null} */
		this['f'] = null;
		const k = String(x);
		// @ts-ignore
		this[k] = 1;
		const fn = () => {
			this.g = 1;
		};
		fn();
		function fn2() {
			// @ts-ignore
			this.h = 1;
		}
		fn2();
	}

	fn1() {
		/** Description 3 */
		this.i = true;
		this.c = 2;
		return this.#b;
	}

	static fn2() {
		/** Description 4 */
		this.j = 1;
	}
}

A.prototype.k = 1;
A.l = 1;

/** @template T */
export class B {
	/** @param {T} x */
	constructor(x) {
		/** @type {T} */
		this.a = x;
	}
}

/** @typedef {A} C */

export class D {
	fn1() {
		this.a = 1;
	}

	get b() {
		return 1;
	}
}

export class E {
	fn1() {
		/** Description 5 */
		this.a = 2;
		this.c = 1;
	}

	constructor() {
		/** Description 6 */
		this.a = 1;
		this.b = 1;
		const fn = () => {
			this.d = 1;
		};
		fn();
	}
}

export class F {
	fn1() {
		/**
		 * Description 7
		 * @protected
		 */
		this.a = 2;
		/** Description 8 */
		this.b = 1;
	}

	constructor() {
		/** @type {number} */
		this.a = 1;
		this.b = 2;
		/** Description 9 */
		this.b = 3;
	}
}

export class H {
	constructor() {
		this.a = 1;
		this.b = 1;
	}

	fn1() {
		this.c = 1;
	}
}

export class I extends H {
	constructor() {
		super();
		this.a = 2;
		/** Description 10 */
		this.b = 2;
		this.d = 2;
	}

	/** @override */
	fn1() {
		/** Description 11 */
		this.c = 2;
		this.e = 2;
	}
}

export class J extends H {
	constructor() {
		super();
		/** @type {number} */
		this.a = 3;
		/**
		 * Description 12
		 * @type {number}
		 */
		this.b = 3;
		this.c = 3;
	}

	fn2() {
		/** Description 13 */
		this.c = 4;
	}
}

export class K {
	/** @type {number | undefined} */
	static s = 1;
	/** @type {number | undefined} */
	static t = 1;
}

export class L extends K {
	constructor() {
		super();
	}

	static fn1() {
		/** Description 15 */
		this.s = 3;
		/**
		 * Description 16
		 * @readonly
		 */
		this.t = 3;
	}

	static {
		this.s = 2;
		/** Description 14 */
		this.t = 2;
	}
}

export class M {
	fn1() {
		/** @readonly */
		// @ts-expect-error readonly outside the constructor
		this.a = 2;
	}

	constructor() {
		/** Description 17 */
		this.a = 1;
	}
}

export class N extends H {
	fn2() {
		/** @readonly */
		// @ts-expect-error readonly outside the constructor
		this.a = 4;
	}

	constructor() {
		super();
		/** Description 18 */
		this.a = 4;
	}
}

export class O {
	constructor() {
		/** Description 19 */
		this.a = 1;
	}

	fn1() {
		/** @private */
		this.a = 2;
	}
}

/** @typedef {O} P */

/**
 * @template T
 * @typedef {{readonly [K in keyof T]: T[K]}} Ro
 */

/**
 * @template T
 * @template {keyof T} K
 * @typedef {{[S in K]: T[S]}} Pk
 */

/** @typedef {Ro<O>} Q */

/** @typedef {Pk<O, 'a'>} R */

export class S {
	fn1() {
		/** @private */
		this.a = 1;
	}

	/** Description 20 */
	a = 0;
}

/** @typedef {Ro<S>} T */

/** @typedef {Pk<S, 'a'>} U */

export class V {
	fn1() {
		this.a = 1;
	}

	constructor() {
		this.b = 2;
	}

	/** Description 21 */
	a = 0;

	/** Description 22 */
	b = 0;
}

export class W {
	static fn1() {
		this.a = 1;
	}

	/** Description 23 */
	static a = 0;
}
