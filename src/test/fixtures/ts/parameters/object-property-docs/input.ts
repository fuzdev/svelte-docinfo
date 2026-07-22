/**
 * A function with documented object-parameter properties.
 *
 * @param ctx - the context object
 * @param ctx.node - the parent node
 * @param ctx.label - the display label
 * @param ctx.nested.deep - a deeply nested property
 * @returns the label
 */
export function fn(ctx: { node: string; label: string; nested: { deep: boolean } }): string {
	return ctx.label;
}
