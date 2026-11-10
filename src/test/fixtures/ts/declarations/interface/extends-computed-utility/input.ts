import type { Omit, Partial, Pick, Readonly } from 'utilpkg';

/** Description 1 */
export interface B {
	/** Description 2 */
	a: string;
	/** Description 3 */
	b: number;
	c?: boolean;
}

/** Description 4 */
export interface A1 extends Omit<B, 'b'> {}

/** Description 5 */
export interface A2 extends Pick<B, 'a'> {
	d: string;
}

/** Description 6 */
export interface A3 extends Partial<B> {}

/** Description 7 */
export interface A4 extends Readonly<B> {}
