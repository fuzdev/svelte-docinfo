export class A {
	a = 1;
}

// @ts-expect-error erasableSyntaxOnly
export enum B {
	b = 'b'
}

export const a: [typeof A, A] = [A, new A()];

export const b: { b: typeof B } | null = null;

export const c: typeof A | null = null;

// @ts-expect-error erasableSyntaxOnly
export namespace C {
	export const c = 1;
}

export const d: [typeof B, typeof C, B] = [B, C, B.b];
