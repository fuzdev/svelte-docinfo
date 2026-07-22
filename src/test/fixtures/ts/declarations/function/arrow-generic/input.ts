/**
 * A generic arrow function assigned to a const.
 *
 * @param a - Description 1
 * @returns Description 2
 */
export const fn = <T extends { id: number }>(a: Array<T>): T | undefined => a[0];
