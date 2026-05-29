/**
 * An interface that extends multiple interfaces.
 */
interface B {
	a: string;
}

interface C {
	b: number;
}

export interface A extends B, C {
	/** Description 1 */
	c: boolean;
}
