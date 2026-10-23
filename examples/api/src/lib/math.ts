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

// a `const` arrow extracts like a `function` declaration, as `kind: 'function'`

/**
 * Multiply two numbers.
 * @param a - first number
 * @param b - second number
 * @returns the product
 */
export const multiply = (a: number, b: number): number => a * b;

/**
 * Sum a list by a numeric projection of each item.
 * @param items - values to sum
 * @param toNumber - projects each item to the number added
 * @returns the total, `0` for an empty list
 * @example
 * ```ts
 * sumBy([{ n: 1 }, { n: 2 }], (item) => item.n) // 3
 * ```
 */
export function sumBy<T>(items: ReadonlyArray<T>, toNumber: (item: T) => number): number {
	let total = 0;
	for (const item of items) total += toNumber(item);
	return total;
}

/**
 * Round a number to a fixed count of decimal places.
 * @param value - number to round
 * @param precision - decimal places to keep
 * @returns the rounded number
 * @internal shared with `Calculator.svelte`, not a stable API
 */
export function roundTo(value: number, precision: number): number {
	const factor = 10 ** precision;
	return Math.round(value * factor) / factor;
}

/** Configuration for math operations. */
export interface MathConfig {
	/** Decimal places kept when `round` is set. */
	precision: number;
	/** Round results to `precision`? */
	round: boolean;
}

/** A 2D vector. */
export interface Vector2 {
	x: number;
	y: number;
}

/**
 * Add one vector into another.
 * @param target - vector to mutate
 * @param source - vector to add
 * @mutates target - adds into its `x` and `y` fields rather than returning a new vector
 */
export function addVector(target: Vector2, source: Vector2): void {
	target.x += source.x;
	target.y += source.y;
}
