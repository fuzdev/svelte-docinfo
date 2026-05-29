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

/** A 2D vector. */
export interface Vector2 {
	x: number;
	y: number;
}

/**
 * Add vectors in place.
 * @param target - vector to mutate
 * @param source - vector to add
 * @mutates target - modifies x and y fields
 */
export const add_vector = (target: Vector2, source: Vector2): void => {
	target.x += source.x;
	target.y += source.y;
};
