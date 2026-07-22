/**
 * A generic arrow function with generics on the type annotation.
 *
 * @param a - Description 1
 * @returns Description 2
 */
export const fn: <T extends { id: number }>(a: Array<T>) => T | undefined = (a) => a[0];
