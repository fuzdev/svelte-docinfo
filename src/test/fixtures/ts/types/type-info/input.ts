type A = 'a' | 'b' | 'c';

// @ts-expect-error erasableSyntaxOnly
enum E {
	A = 'a',
	B = 'b'
}

interface B {
	a: string;
}

interface M<T, U> {
	a: T;
	b: U;
}

export type O = {
	a?: A;
	b?: E | null;
	c: 'a' | 'b';
	d?: boolean;
	e: M<string, B>;
	f?: B;
	g?: (() => void) | null;
	h: string;
	// the checker expands `boolean` inside a union, so both of these walk a
	// `true | false` literal pair that collapses back to the intrinsic
	i?: boolean | null;
	j: boolean | 'x';
};
