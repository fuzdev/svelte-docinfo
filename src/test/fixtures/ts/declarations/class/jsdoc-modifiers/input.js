export class A {
	/** @private */
	a = 1;
	/** @protected */
	b = 2;
	/** @public */
	c = 3;
	/** @readonly */
	d = 4;
	/**
	 * Description 1
	 * @protected
	 * @readonly
	 */
	e = 5;
	#f = 6;
	/** @static */
	g = 7;
	/** @abstract */
	h = 8;
	i = 9;
	/** @private */
	fn1() {
		return this.a + this.#f + this.j;
	}
	/** @protected */
	fn2() {
		return this.fn1();
	}
	/** @protected */
	static fn3() {}
	/** @protected @readonly */
	static t = 1;
	/** @private */
	get j() {
		return 1;
	}
	/** @protected */
	get k() {
		return 1;
	}
	/**
	 * @protected
	 * @param {number} x
	 */
	set k(x) {
		this.b = x;
	}
	get l() {
		return 1;
	}
	/**
	 * @private
	 * @param {number} x
	 */
	set l(x) {
		this.b = x;
	}
	/** @protected */
	constructor() {}
}

export class D extends A {
	/** @override */
	i = 10;
	/** @private */
	constructor() {
		super();
	}
}

/** @typedef {A} B */

export const o = {
	/** @private */
	a: 1,
	/** @readonly */
	b: 2,
	/** @private */
	fn1() {
		return 1;
	}
};

/** @typedef {typeof o} E */
