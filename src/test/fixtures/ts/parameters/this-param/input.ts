/**
 * A function with this parameter.
 *
 * @param a - Description 1
 * @returns Description 2
 */
export function fn(this: {value: string}, a: number): string {
	return this.value + a;
}
