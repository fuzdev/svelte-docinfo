/**
 * Function types.
 */
export type A = {
	a: (x: string) => void;
	b: (x: number, y?: boolean) => string;
	c: (...args: Array<number>) => number;
};
