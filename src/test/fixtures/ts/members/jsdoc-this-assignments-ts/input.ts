export class A {
	/** Description 1 */
	a = 1;
	#b = 2;
	/**
	 * Description 2
	 */
	c: number;
	private d: number;
	protected readonly e: string;
	f: string | null;
	g: number | undefined;
	/** Description 3 */
	i: boolean | undefined;
	/** Description 4 */
	static j: number | undefined;

	constructor(x: number) {
		this.a = x;
		this.#b = x;
		this.c = x;
		this.d = 1;
		this.e = 'a';
		this['f'] = null;
		const k = String(x);
		// @ts-ignore
		this[k] = 1;
		const fn = () => {
			this.g = 1;
		};
		fn();
	}

	fn1(): number {
		this.i = true;
		this.c = 2;
		return this.#b + this.d;
	}

	static fn2(): void {
		this.j = 1;
	}
}

export class B<T> {
	a: T;
	constructor(x: T) {
		this.a = x;
	}
}

export type C = A;

export class D {
	a: number | undefined;

	fn1(): void {
		this.a = 1;
	}

	get b(): number {
		return 1;
	}
}

export class E {
	/** Description 6 */
	a: number;
	b: number;
	d!: number;
	c: number | undefined;

	fn1(): void {
		this.a = 2;
		this.c = 1;
	}

	constructor() {
		this.a = 1;
		this.b = 1;
		const fn = () => {
			this.d = 1;
		};
		fn();
	}
}

export class F {
	fn1(): void {
		this.a = 2;
		this.b = 1;
	}

	/** Description 7 */
	protected a: number;
	/** Description 9 */
	b: number;

	constructor() {
		this.a = 1;
		this.b = 2;
		this.b = 3;
	}
}

export class H {
	a: number;
	b: number;
	c: number | undefined;

	constructor() {
		this.a = 1;
		this.b = 1;
	}

	fn1(): void {
		this.c = 1;
	}
}

export class I extends H {
	d: number;
	e: number | undefined;

	constructor() {
		super();
		this.a = 2;
		this.b = 2;
		this.d = 2;
	}

	override fn1(): void {
		this.c = 2;
		this.e = 2;
	}
}

export class J extends H {
	constructor() {
		super();
		this.a = 3;
		this.b = 3;
		this.c = 3;
	}

	fn2(): void {
		this.c = 4;
	}
}

export class K {
	static s: number | undefined = 1;
	static t: number | undefined = 1;
}

export class L extends K {
	constructor() {
		super();
	}

	static fn1(): void {
		this.s = 3;
		this.t = 3;
	}

	static {
		this.s = 2;
		this.t = 2;
	}
}

export class M {
	fn1(): void {
		// @ts-expect-error readonly outside the constructor
		this.a = 2;
	}

	/** Description 17 */
	readonly a: number;

	constructor() {
		this.a = 1;
	}
}

export class N extends H {
	fn2(): void {
		this.a = 4;
	}

	constructor() {
		super();
		this.a = 4;
	}
}

export class O {
	/** Description 19 */
	a: number;

	constructor() {
		this.a = 1;
	}

	fn1(): void {
		this.a = 2;
	}
}

export type P = O;

export type Ro<T> = { readonly [K in keyof T]: T[K] };

export type Pk<T, K extends keyof T> = { [S in K]: T[S] };

export type Q = Ro<O>;

export type R = Pk<O, 'a'>;

export class S {
	/** Description 20 */
	a = 0;

	fn1(): void {
		this.a = 1;
	}
}

export type T = Ro<S>;

export type U = Pk<S, 'a'>;

export class V {
	fn1(): void {
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
	static fn1(): void {
		this.a = 1;
	}

	/** Description 23 */
	static a = 0;
}
