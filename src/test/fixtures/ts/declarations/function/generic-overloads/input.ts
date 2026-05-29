/** Description. */
export function fn<T>(a: T): T;
export function fn<T, U>(a: T, b: U): [T, U];
export function fn<T, U>(a: T, b?: U): T | [T, U] {
	return b !== undefined ? [a, b] : a;
}
