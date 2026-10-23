/**
 * Description 1.
 * @param a - Description 2
 * @returns Description 3
 * @example
 * fn1('a');
 * @see https://fuz.dev
 */
export function fn1(a: string): string;
/**
 * Description 4.
 * @param a - Description 5
 * @returns Description 6
 * @since 1.0.0
 * @deprecated
 */
export function fn1(a: number): number;
/**
 * Description 7.
 * @param a - Description 8
 * @returns Description 9
 * @example
 * fn1(1);
 * @nodocs
 */
export function fn1(a: string | number): string | number {
	return a;
}

/**
 * Description 1.
 * @param a - Description 2
 * @param b - Description 3
 * @param c - Description 4
 * @param d - Description 5
 */
export function fn2(a: string, b?: number, c?: boolean, d?: number): void;
/**
 * Description 6.
 * @param rest - Description 7
 */
export function fn2(...rest: Array<string>): void;
export function fn2(...args: Array<unknown>): void {
	console.log(args);
}

/**
 * Description 1.
 */
export function fn3<T>(a: T): T;
/**
 * Description 2.
 */
export function fn3<U extends string, V = number>(a: U, b: V): [U, V];
export function fn3<W>(a: W, b?: unknown): unknown {
	return b === undefined ? a : [a, b];
}

/**
 * Description 1.
 * @param a - Description 2
 */
export function fn5(a: string): string;
export function fn5(a: string): string {
	return a;
}

export function fn6(a: string): string;
export function fn6(a: number): number;
/**
 * Description 1.
 * @param a - Description 2
 */
export function fn6(a: string | number): string | number {
	return a;
}

export function fn7(a: string): string;
/**
 * @deprecated
 */
export function fn7(a: number): number;
export function fn7(a: string | number): string | number {
	return a;
}

/**
 * Description 1.
 */
export function fn8(a: string): string;
/**
 * Description 1.
 * @deprecated
 */
export function fn8(a: number): number;
export function fn8(a: string | number): string | number {
	return a;
}
