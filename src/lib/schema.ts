/**
 * Helpers shared by the modules that declare output schemas (`types.ts`,
 * `diagnostics.ts`, `analyze-core.ts`).
 *
 * `VariantSchema` is the type their variant exports are annotated with, and
 * `parseWithSummary` is what the public `parse*` helpers throw through, so a
 * failure names every reported issue with its path, not just the first ten,
 * and says when the list may be cut off.
 *
 * A leaf: it imports only fuz_schema, so any schema module can depend on it
 * without pulling in another.
 *
 * @module
 */

import * as s from '@fuzdev/fuz_schema/schema.ts';

/**
 * The type of a `s.variant` over `T`, written out so a schema module can
 * annotate a variant export and keep its emitted declaration referential
 * (each option by name, not re-inlined).
 *
 * Exported only so the schema modules can share it.
 *
 * @nodocs
 */
export type VariantSchema<
	TKey extends string,
	T extends ReadonlyArray<s.Schema<any, any, string, s.SchemaEntries>>
> = s.Schema<
	s.Infer<T[number]>,
	s.InferInput<T[number]>,
	'variant',
	{ readonly key: TKey; readonly options: T }
>;

// fuz_schema builds at most this many issues for a parse and puts nothing on
// the result to say that more failed, so a result holding exactly this many
// may be cut off. The cap is fixed in fuz_schema and not exported: this
// mirrors it, and a change there makes the note below silently stop appearing
// (the `parse helpers` tests in `types.test.ts` fail then)
const ISSUE_CAP = 100;

/**
 * Validate `value` against `schema`, throwing an error that lists every issue
 * the parse reports.
 *
 * `s.parse_or_throw`'s message stops at ten issues; this one lists every issue
 * the parse builds, one per line, as `s.format_issue_with_value` writes it:
 * `path: expected X, received Y`, or the bare text for an issue at the root,
 * where `Y` is the value that failed when it's a string, number, or boolean
 * (a string quoted as JSON and cut at 32 code units, so `received "funtion"`),
 * and its type otherwise (`received undefined`, `received object`). An unknown
 * key reads its value's type, never the value. So the message carries short
 * pieces of `value`'s values, which `issues` never does. Unknown keys of a strict
 * object are each reported. fuz_schema builds at most a hundred issues for a
 * parse, so a message of a hundred ends with a line saying there may be more.
 *
 * @param schema - the schema to validate against
 * @param value - the value to validate
 * @returns the parsed output, defaults applied
 * @throws SchemaError when `value` doesn't match; `message` lists the issues
 *   in the format above and `issues` holds them structured
 * @internal
 */
export const parseWithSummary = <TSchema extends s.Schema>(
	schema: TSchema,
	value: unknown
): s.Infer<TSchema> => {
	const result = s.parse(schema, value);
	if (result.ok) return result.value;
	const error = new s.SchemaError(result.issues);
	const lines = result.issues.map((issue) => s.format_issue_with_value(issue, value));
	if (result.issues.length === ISSUE_CAP) {
		lines.push(`(only the first ${ISSUE_CAP} issues are reported, there may be more)`);
	}
	error.message = lines.join('\n');
	throw error;
};
