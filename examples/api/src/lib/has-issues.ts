/**
 * This file exists to exercise the `analyze-diagnostics.js` example —
 * the `@param` below intentionally names a parameter that doesn't exist,
 * so the analyzer emits an `unknown_param` warning. Real code shouldn't
 * have this issue, but documentation slips happen, and the `diagnostics`
 * field lets consumers surface them without halting analysis.
 * @module
 */

/**
 * Demonstrates a documentation mistake the analyzer catches.
 * @param missing - this name doesn't match any real parameter
 * @returns the input doubled
 */
export const demonstrate_typo = (value: number): number => value * 2;
