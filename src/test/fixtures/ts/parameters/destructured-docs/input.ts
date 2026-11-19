/**
 * @param a - Description 1
 * @param a.b - Description 2
 * @param c - Description 3
 */
export function fn1({ b }: { b: string }, c: number): string {
	return b + c;
}

/**
 * @param a - Description 1
 * @param a.b - Description 2
 * @param c - Description 3
 */
export function fn2(a: { b: string }, { c }: { c: number }): string {
	return a.b + c;
}

export interface Api {
	/**
	 * A callable property's destructured parameter takes the property's tag in
	 * its position.
	 *
	 * @param opts - the options
	 * @param opts.b - the b
	 */
	m: ({ b }: { b: string }) => void;
}
