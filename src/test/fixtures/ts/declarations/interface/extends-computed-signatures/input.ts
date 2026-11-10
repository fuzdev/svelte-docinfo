type B = {
	/** Description 1 */
	(a: string): number;
	new (a: string): B;
	[key: string]: unknown;
	[key: number]: string;
};

/**
 * A computed heritage's call, construct, and index signatures, unless the
 * interface declares the key type itself.
 */
export interface A extends B {
	/** Description 2 */
	(a: number): number;
	[key: number]: 'a';
}
