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
export const add = (a: number, b: number): number => a + b;

/**
 * Multiply two numbers.
 * @param a - first number
 * @param b - second number
 * @returns the product
 */
export const multiply = (a: number, b: number): number => a * b;

/** Configuration for math operations. */
export interface MathConfig {
	/** Decimal precision. */
	precision: number;
	/** Round results? */
	round: boolean;
}
