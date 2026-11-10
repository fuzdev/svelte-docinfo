interface B {
	/** Description 1 */
	a: string;
	b: number;
}

type Partial<T> = { [K in keyof T]?: T[K] };

/**
 * Only the first block documents: the second block's `a` documents nothing,
 * and drops from the heritage's contribution too.
 */
export interface A1 extends Partial<B> {
	c: boolean;
}
export interface A1 {
	a: 'a';
}

/**
 * The second block's members and heritage document nothing, its own call
 * signature aside.
 */
export interface A2 {
	c: boolean;
}
export interface A2 extends Partial<B> {
	d: string;
	(x: 1): 1;
}
