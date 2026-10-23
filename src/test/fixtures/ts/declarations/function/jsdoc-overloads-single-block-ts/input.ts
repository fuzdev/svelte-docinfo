/**
 * Description 1.
 * @param a - Description 2
 * @returns Description 3
 * @deprecated
 */
export function fn1<T>(a: T): T;
/**
 * Description 1.
 * @param a - Description 4
 * @param b - Description 5
 * @returns Description 6
 * @deprecated
 */
export function fn1<T>(a: number, b?: string): number;
export function fn1(a: unknown, b?: string): unknown {
	return b === undefined ? a : 0;
}

export function fn2(a: string): string;
/**
 * Description 1.
 * @param a - Description 2
 */
export function fn2(a: number): number;
/**
 * Description 1.
 * @param a - Description 3
 */
export function fn2(a: boolean): boolean;
export function fn2(a: string | number | boolean): string | number | boolean {
	return a;
}
