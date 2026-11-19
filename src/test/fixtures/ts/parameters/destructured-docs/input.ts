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
