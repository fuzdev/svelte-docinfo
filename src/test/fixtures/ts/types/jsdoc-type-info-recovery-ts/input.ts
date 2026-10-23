const a = { b: 'a' as 'a' | 'b', c: { d: 1 } };

// an indexed-access right-hand side loses `aliasSymbol`; unexported, so only
// the written channel names it
type A = (typeof a)['b'];

type B = (typeof a)['c'];

export function fn1(x: A, y?: B): B | undefined {
	void x;
	return y;
}

export const b: A = 'a';

export const c: B | null = null;

export class C {
	a: A = 'a';

	get b(): B {
		return a.c;
	}

	get c(): B {
		return a.c;
	}

	set d(x: A) {
		void x;
	}
}
