/**
 * Keyof and typeof operators.
 */
const b = {a: 'value', c: 1} as const;

type C = {a: string; b: number};

export type A = {
	a: keyof C;
	b: typeof b;
};
