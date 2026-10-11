import ts from 'typescript';
import * as v from 'valibot';

import type { TsdocParsedComment } from '#lib/tsdoc.ts';
import { parseComment } from '#lib/tsdoc.ts';
import { ComponentPropJson } from '#lib/types.ts';

import { loadFixturesGeneric, type GenericFixture } from '../../test-helpers.ts';

export type TsdocFixture = GenericFixture<TsdocParsedComment | null>;

/**
 * Schema mirror of `TsdocParsedComment`, for validating what `expected.json`
 * holds. Test-side rather than in `tsdoc.ts` because a parsed comment is an
 * intermediate, never wire data — the lib's schemas
 * (`types.ts`, `diagnostics.ts`) are the output data model.
 */
// the lib's unexported string-record schema, reached through a field that uses
// it, so `constructor`/`prototype` keys validate here as they do in the output
const StringRecord = v.unwrap(ComponentPropJson.entries.mutates);

const TsdocParsedCommentJson = v.strictObject({
	text: v.string(),
	params: StringRecord,
	returns: v.optional(v.string()),
	throws: v.optional(
		v.array(v.strictObject({ type: v.optional(v.string()), description: v.string() }))
	),
	examples: v.optional(v.array(v.string())),
	deprecatedMessage: v.optional(v.string()),
	internalMessage: v.optional(v.string()),
	seeAlso: v.optional(v.array(v.string())),
	since: v.optional(v.string()),
	defaultValue: v.optional(v.string()),
	mutates: v.optional(StringRecord),
	nodocs: v.optional(v.boolean())
});

/**
 * `TsdocParsedComment`, but only while the schema above mirrors every key of
 * it — carried in `validateTsdocStructure`'s parameter type so the guard can't
 * be dropped as unused.
 *
 * Parsing checks only the fields the schema declares, so a field added to
 * `TsdocParsedComment` and forgotten in the mirror would go unvalidated in
 * silence — exactly how the hand-rolled predecessor came to skip
 * `defaultValue`. A key on either side and not the other collapses this to
 * `never`, and every call to `validateTsdocStructure` stops compiling.
 */
type SchemaMirroredComment = [
	Exclude<keyof TsdocParsedComment, keyof v.InferOutput<typeof TsdocParsedCommentJson>>,
	Exclude<keyof v.InferOutput<typeof TsdocParsedCommentJson>, keyof TsdocParsedComment>
] extends [never, never]
	? TsdocParsedComment
	: never;

/**
 * Load all fixtures from the tsdoc fixtures directory.
 */
export const loadFixtures = async (): Promise<Array<TsdocFixture>> =>
	loadFixturesGeneric<TsdocParsedComment | null>({
		fixturesDir: import.meta.dirname,
		inputExtension: '.ts'
	});

/**
 * Find and parse TSDoc from the first exported declaration in a source file.
 * Used by both tests and update tasks to ensure consistent behavior.
 *
 * @param sourceFile - The TypeScript source file to search
 * @returns The parsed TSDoc comment, or null if not found
 */
export const findAndParseTsdoc = (sourceFile: ts.SourceFile): TsdocParsedComment | null => {
	for (const statement of sourceFile.statements) {
		// Check for export assignments
		if (ts.isExportAssignment(statement)) {
			return parseComment(statement.expression, sourceFile) ?? null;
		}

		// Check for exported declarations
		if (
			ts.isFunctionDeclaration(statement) ||
			ts.isVariableStatement(statement) ||
			ts.isTypeAliasDeclaration(statement) ||
			ts.isInterfaceDeclaration(statement) ||
			ts.isClassDeclaration(statement)
		) {
			const modifiers = ts.getModifiers(statement);
			const isExported = modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword);

			if (isExported) {
				return parseComment(statement, sourceFile) ?? null;
			}
		}
	}

	return null;
};

/**
 * Validate that a parsed TSDoc comment has the expected structure — parses
 * through the schema mirror above, which is strictly stronger than any
 * hand-rolled structural check (unknown keys rejected, nested `throws` entries
 * checked) and, with the coverage guard, can't fall behind the type. Mirrors
 * `validateModuleFixture` for the ts and svelte sets.
 */
export const validateTsdocStructure = (tsdoc: SchemaMirroredComment | undefined): void => {
	if (!tsdoc) {
		throw new Error('Expected tsdoc to be defined');
	}
	v.parse(TsdocParsedCommentJson, tsdoc);
};
