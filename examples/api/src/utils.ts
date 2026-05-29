/**
 * Clamp a value to a range.
 * @param value - value to clamp
 * @param min - minimum bound
 * @param max - maximum bound
 * @returns the clamped value
 */
export const clamp = (value: number, min: number, max: number): number =>
	Math.min(Math.max(value, min), max);
