/**
 * Helpers shared by the modules that declare output schemas (`types.ts`,
 * `diagnostics.ts`, `analyze-core.ts`).
 *
 * `Named` is the alias their schema interfaces extend through, and
 * `parseWithSummary` is what the public `parse*` helpers throw through, so a
 * failure names every reported issue with its path, not just the first one's
 * text.
 *
 * A leaf: it imports only valibot, so any schema module can depend on it
 * without pulling in another.
 *
 * @module
 */

import * as v from 'valibot';

/**
 * Identity alias that lets an interface extend an inferred schema type:
 * `interface FooSchema extends Named<typeof FooImpl> {}`. A heritage clause
 * can't hold a bare `typeof` query, and going through the alias spares a
 * per-schema one. The schema modules explain why they name their schemas
 * (see `types.ts`).
 *
 * Exported only so the schema modules can share it.
 *
 * @nodocs
 */
export type Named<T> = T;

/**
 * Validate `value` against `schema`, throwing an error that lists every issue
 * valibot reports.
 *
 * Collects all issues rather than stopping at the first, and replaces the
 * message valibot's own `parse` would throw (the first issue only, with no
 * path). The format is this package's own, built from each issue's `message`
 * and `v.getDotPath`: one line per issue, in issue order, as `path: message`,
 * or the bare `message` when the issue has no dot path (the root value, or a
 * path through a key a dot path can't express).
 *
 * That isn't every problem in the value: a strict object with several unknown
 * keys reports only the first, so fixing one can surface the next.
 *
 * @param schema - the schema to validate against
 * @param value - the value to validate
 * @returns the parsed output, defaults applied
 * @throws ValiError when `value` doesn't match; `message` lists the issues
 *   in the format above and `issues` holds them structured
 * @internal
 */
export const parseWithSummary = <TSchema extends v.GenericSchema>(
	schema: TSchema,
	value: unknown
): v.InferOutput<TSchema> => {
	const result = v.safeParse(schema, value);
	if (result.success) return result.output;
	const error = new v.ValiError(result.issues);
	error.message = result.issues
		.map((issue) => {
			const path = v.getDotPath(issue);
			return path ? `${path}: ${issue.message}` : issue.message;
		})
		.join('\n');
	throw error;
};
