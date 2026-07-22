// @ts-nocheck
import type { B } from './nonexistent_module.js';

/**
 * Description 1.
 */
export class A {
	a: B;

	fn() {
		return 'value';
	}

	/**
	 * Description 2.
	 */
	c: string;
}

/**
 * Description 3.
 */
export const fn2 = (a: B): string => {
	return 'value';
};
