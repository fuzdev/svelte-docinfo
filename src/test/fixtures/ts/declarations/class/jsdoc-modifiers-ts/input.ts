export class A {
	private a = 1;
	protected b = 2;
	public c = 3;
	readonly d = 4;
	/**
	 * Description 1
	 */
	protected readonly e = 5;
	#f = 6;
	/** @static */
	g = 7;
	/** @abstract */
	h = 8;
	i = 9;
	private fn1() {
		return this.a + this.#f + this.j;
	}
	protected fn2() {
		return this.fn1();
	}
	protected static fn3() {}
	protected static readonly t = 1;
	private get j() {
		return 1;
	}
	protected get k() {
		return 1;
	}
	protected set k(x: number) {
		this.b = x;
	}
	get l() {
		return 1;
	}
	private set l(x: number) {
		this.b = x;
	}
	protected constructor() {}
}

export class D extends A {
	override i = 10;
	private constructor() {
		super();
	}
}

/** @private */
export class C {
	/** @private */
	a = 1;
	/** @protected */
	b = 2;
	/** @readonly */
	c = 3;
	constructor(
		// @ts-expect-error erasableSyntaxOnly
		private d: number,
		// @ts-expect-error erasableSyntaxOnly
		protected e: number
	) {}
}

export type B = A;

export type F = C;

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

export type E = typeof o;
