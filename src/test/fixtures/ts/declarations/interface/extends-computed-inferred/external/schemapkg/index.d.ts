export interface Schema<O> {
	readonly _output: O;
}
export type Infer<S> = S extends Schema<infer O> ? O : never;
export type ObjectOutput<E extends { [key: string]: Schema<unknown> }> = {
	[K in keyof E]: Infer<E[K]>;
};
export declare const string: Schema<string>;
export declare const number: Schema<number>;
export declare const object: <E extends { [key: string]: Schema<unknown> }>(
	entries: E
) => Schema<ObjectOutput<E>>;
