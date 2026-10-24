interface A {
	a: string;
}

interface B {
	b: number;
}

export class C<T> {
	c: T | undefined = undefined;
}

/**
 * Description 1
 * @extends {C<number>}
 * @implements {A}
 */
export class D extends C<string> implements A, B {
	a = '';
	b = 1;
}
