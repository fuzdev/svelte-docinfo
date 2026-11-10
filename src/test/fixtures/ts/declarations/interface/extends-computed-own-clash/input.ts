type B = {
	/** Description 1 */
	a: string | number;
	/** Description 2 */
	b?: number;
	c: boolean;
};

/**
 * Own members win over a computed heritage's, and come first.
 */
export interface A extends B {
	/** Description 3 */
	a: string;
	fn(): void;
}
