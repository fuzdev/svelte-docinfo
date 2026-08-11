import ts from 'typescript';
import { z } from 'zod';

import type { TsdocParsedComment } from '$lib/tsdoc.ts';
import { parseComment } from '$lib/tsdoc.ts';

import { loadFixturesGeneric, type GenericFixture } from '../../test-helpers.ts';

export type TsdocFixture = GenericFixture<TsdocParsedComment | null>;

/**
 * Schema mirror of `TsdocParsedComment`, for validating what `expected.json`
 * holds. Test-side rather than in `tsdoc.ts` because a parsed comment is an
 * intermediate, never wire data — the lib's Zod schemas
 * (`types.ts`, `diagnostics.ts`) are the output data model.
 */
const TsdocParsedCommentJson = z.strictObject({
	text: z.string(),
	params: z.record(z.string(), z.string()),
	returns: z.string().optional(),
	throws: z
		.array(z.strictObject({ type: z.string().optional(), description: z.string() }))
		.optional(),
	examples: z.array(z.string()).optional(),
	deprecatedMessage: z.string().optional(),
	internalMessage: z.string().optional(),
	seeAlso: z.array(z.string()).optional(),
	since: z.string().optional(),
	defaultValue: z.string().optional(),
	mutates: z.record(z.string(), z.string()).optional(),
	nodocs: z.boolean().optional()
});

/**
 * `TsdocParsedComment`, but only while the schema above mirrors every key of
 * it — carried in `validateTsdocStructure`'s parameter type so the guard can't
 * be dropped as unused.
 *
 * `.parse` checks only the fields the schema declares, so a field added to
 * `TsdocParsedComment` and forgotten in the mirror would go unvalidated in
 * silence — exactly how the hand-rolled predecessor came to skip
 * `defaultValue`. A key on either side and not the other collapses this to
 * `never`, and every call to `validateTsdocStructure` stops compiling.
 */
type SchemaMirroredComment = [
	Exclude<keyof TsdocParsedComment, keyof z.infer<typeof TsdocParsedCommentJson>>,
	Exclude<keyof z.infer<typeof TsdocParsedCommentJson>, keyof TsdocParsedComment>
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
	TsdocParsedCommentJson.parse(tsdoc);
};
