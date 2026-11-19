/**
 * A function with destructured array parameters.
 *
 * @param a - Description 1
 * @returns Description 2
 */
export function fn([a, b]: [string, number]): string {
	return a + b;
}

/**
 * A pattern-named tag: TypeScript reads `[a` as an optional bracket, so the
 * description must not start with the pattern's rest.
 *
 * @param [a, b] - the pair
 */
export function fn_pattern_tag([a, b]: [string, number]): string {
	return a + b;
}

/**
 * A one-element pattern's tag reads as a bracketed name, which names nothing.
 *
 * @param [d] - the single
 */
export function fn_single_tag([d]: [number]): number {
	return d;
}
