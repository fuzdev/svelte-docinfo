/**
 * The merged value+type pattern: a runtime schema and its inferred type
 * sharing one exported name (`z.strictObject` + `z.infer` in real code).
 * The declaration documents the type meaning with full structure, and
 * `mergedValue: true` marks the name as also importable as a runtime value.
 * @module
 */

/** Minimal stand-in for a schema library's parser type. */
export interface Parser<O> {
	/** Parse unknown input, returning the output type. */
	parse(input: unknown): O;
}

/** Extract a parser's output type — the `z.infer` analogue. */
export type Infer<P extends Parser<unknown>> = P extends Parser<infer O> ? O : never;

const create_parser = <O>(): Parser<O> => ({
	parse: (input) => input as O
});

/**
 * A 2D point schema — parse values with `Point.parse(input)`, type them as
 * `Point`. Documented on the const; the merged declaration falls back to it.
 */
export const Point: Parser<{ x: number; y: number }> = create_parser();
export type Point = Infer<typeof Point>;
