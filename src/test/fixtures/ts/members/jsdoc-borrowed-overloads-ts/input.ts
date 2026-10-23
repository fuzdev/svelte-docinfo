/**
 * Description 1.
 * @example
 * fn1('a');
 */
export function fn1(a: string): string;
/**
 * Description 2.
 * @example
 * fn1(1);
 */
export function fn1(a: number): number;
export function fn1(a: string | number): string | number {
	return a;
}

export type A = {
	/** Description 3 */
	a: typeof fn1;
};

export type B = {
	/** Description 1. */
	a: typeof fn1;
};

interface C {
	/**
	 * Description 4.
	 * @example
	 * c('a');
	 */
	(a: string): string;
	/**
	 * Description 5.
	 * @example
	 * c(1);
	 */
	(a: number): number;
}

export type D = {
	/** Description 6 */
	a: C;
};
