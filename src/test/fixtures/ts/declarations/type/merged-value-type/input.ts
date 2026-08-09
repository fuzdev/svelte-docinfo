interface Schema<O> {
	readonly _output: O;
}
type Infer<S extends Schema<unknown>> = S extends Schema<infer O> ? O : never;
declare const create: <O>() => Schema<O>;

export const Merged: Schema<{ a: string; b: number }> = create();
/**
 * Merged const+type pair — the type alias's structure wins.
 */
export type Merged = Infer<typeof Merged>;
