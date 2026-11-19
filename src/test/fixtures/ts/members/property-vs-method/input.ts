export interface A {
	readonly a: () => number;
	b(): number;
	/** @default () => true */
	c?: (x: string) => boolean;
	d?(x: string): boolean;
	e: <T>(x: T) => T;
}

export type B = {
	readonly a: () => number;
	b(): number;
};

export type C = { [K in 'a' | 'b']: (x: K) => void };

export type D = Pick<A, 'a' | 'b'>;

export class E {
	a = (): number => 1;
	b(): number {
		return 1;
	}
}

export type F = Pick<E, 'a' | 'b'>;
