import type { A as RenamedA } from './a.ts';

export class B<T> {
	b!: T;
}

export interface C {
	c: number;
}

const mixin = <T extends new (...args: Array<any>) => object>(base: T): T => base;

export class D extends B<RenamedA> implements C, RenamedA {
	a = 1;
	c = 1;
}

export class E extends mixin(B)<string> {}

export type G<T> = { [K in keyof T]: T[K] | null };

export interface F<T> extends B<T>, C, G<RenamedA> {}

export class H<T, U = unknown> {
	t!: T;
	u!: U;
}

export class I extends H<string> {}

export type J<T> = import('./a.ts').K<T, T>;

export interface L extends J<number> {}
