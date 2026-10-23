/**
 * Description 1.
 * @param a - Description 2
 * @param b - Description 3
 * @param c - Description 4
 * @returns Description 5
 */
export type A = (a: string, b?: number, ...c: boolean[]) => boolean;

export type B = (a: { x: number }, b?: number) => void;

export type C = {
	/** Description 6 */
	a: A;
};
