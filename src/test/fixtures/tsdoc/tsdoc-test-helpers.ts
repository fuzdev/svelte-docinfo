import ts from 'typescript';

import type { TsdocParsedComment } from '$lib/tsdoc.ts';
import { parseComment } from '$lib/tsdoc.ts';

import { loadFixturesGeneric } from '../../test-helpers.ts';

export interface TsdocFixture {
	name: string;
	input: string;
	expected: TsdocParsedComment | null;
}

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
 * Validate that a parsed TSDoc comment has the expected structure.
 */
export const validateTsdocStructure = (tsdoc: TsdocParsedComment | undefined): void => {
	if (!tsdoc) {
		throw new Error('Expected tsdoc to be defined');
	}

	// Basic structure validation
	if (typeof tsdoc.text !== 'string') {
		throw new Error('Expected tsdoc.text to be a string');
	}

	if (typeof tsdoc.params !== 'object' || tsdoc.params === null || Array.isArray(tsdoc.params)) {
		throw new Error('Expected tsdoc.params to be an object');
	}
	for (const [key, value] of Object.entries(tsdoc.params)) {
		if (typeof key !== 'string') {
			throw new Error('Expected params key to be a string');
		}
		if (typeof value !== 'string') {
			throw new Error('Expected params value to be a string');
		}
	}

	// Validate optional fields
	if (tsdoc.returns !== undefined && typeof tsdoc.returns !== 'string') {
		throw new Error('Expected tsdoc.returns to be a string');
	}

	if (tsdoc.throws !== undefined) {
		if (!Array.isArray(tsdoc.throws)) {
			throw new Error('Expected tsdoc.throws to be an array');
		}
		for (const t of tsdoc.throws) {
			if (typeof t.description !== 'string') {
				throw new Error('Expected throw description to be a string');
			}
			if (t.type !== undefined && typeof t.type !== 'string') {
				throw new Error('Expected throw type to be a string');
			}
		}
	}

	if (tsdoc.examples !== undefined) {
		if (!Array.isArray(tsdoc.examples)) {
			throw new Error('Expected tsdoc.examples to be an array');
		}
		for (const example of tsdoc.examples) {
			if (typeof example !== 'string') {
				throw new Error('Expected example to be a string');
			}
		}
	}

	if (tsdoc.deprecatedMessage !== undefined && typeof tsdoc.deprecatedMessage !== 'string') {
		throw new Error('Expected tsdoc.deprecatedMessage to be a string');
	}

	if (tsdoc.seeAlso !== undefined) {
		if (!Array.isArray(tsdoc.seeAlso)) {
			throw new Error('Expected tsdoc.seeAlso to be an array');
		}
		for (const see of tsdoc.seeAlso) {
			if (typeof see !== 'string') {
				throw new Error('Expected see reference to be a string');
			}
		}
	}

	if (tsdoc.since !== undefined && typeof tsdoc.since !== 'string') {
		throw new Error('Expected tsdoc.since to be a string');
	}

	if (tsdoc.mutates !== undefined) {
		if (typeof tsdoc.mutates !== 'object' || tsdoc.mutates === null) {
			throw new Error('Expected tsdoc.mutates to be an object');
		}
		for (const [key, value] of Object.entries(tsdoc.mutates)) {
			if (typeof key !== 'string') {
				throw new Error('Expected mutates key to be a string');
			}
			if (typeof value !== 'string') {
				throw new Error('Expected mutates value to be a string');
			}
		}
	}

	if (tsdoc.nodocs !== undefined && typeof tsdoc.nodocs !== 'boolean') {
		throw new Error('Expected tsdoc.nodocs to be a boolean');
	}
};
