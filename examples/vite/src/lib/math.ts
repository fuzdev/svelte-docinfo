/**
 * Math utilities for demonstrating svelte-docinfo analysis.
 * @module
 */

/**
 * Add two numbers.
 * @param a - first number
 * @param b - second number
 * @returns the sum
 * @example
 * ```ts
 * add(2, 3) // 5
 * ```
 */
export function add(a: number, b: number): number {
	return a + b;
}

/**
 * Multiply two numbers.
 * @param a - first number
 * @param b - second number
 * @returns the product
 */
export function multiply(a: number, b: number): number {
	return a * b;
}

/** Configuration for math operations. */
export interface MathConfig {
	/** Decimal precision. */
	precision: number;
	/** Round results? */
	round: boolean;
}
