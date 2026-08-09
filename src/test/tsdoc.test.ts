/**
 * Tests for TSDoc/JSDoc parsing utilities (tsdocHelpers.ts).
 *
 * These tests cover:
 * - Fixture-based parsing (all JSDoc tag types)
 * - Comment cleaning and normalization
 * - Tag extraction (@param, @returns, @throws, @example, @deprecated, @internal, @see, @since, @mutates, @nodocs)
 * - Edge cases (empty comments, no comments, malformed JSDoc)
 * - Multi-line descriptions and tag content
 */

import { test, assert, describe, beforeAll } from 'vitest';
import ts from 'typescript';

import { cleanComment, parseComment } from '$lib/tsdoc.ts';

import {
	loadFixtures,
	validateTsdocStructure,
	findAndParseTsdoc,
	type TsdocFixture
} from './fixtures/tsdoc/tsdoc-test-helpers.ts';
import { normalizeJson } from './test-helpers.ts';

let fixtures: Array<TsdocFixture> = [];

beforeAll(async () => {
	fixtures = await loadFixtures();
});

/** Parse the JSDoc of `code`'s first statement. */
const parseFirstStatement = (code: string) => {
	const sourceFile = ts.createSourceFile(
		'mod.ts',
		code,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS
	);
	return parseComment(sourceFile.statements[0]!, sourceFile);
};

describe('tsdoc parser (fixture-based)', () => {
	test('all fixtures parse correctly', () => {
		for (const fixture of fixtures) {
			// Create a source file from the input
			const sourceFile = ts.createSourceFile(
				`${fixture.name}.ts`,
				fixture.input,
				ts.ScriptTarget.Latest,
				true,
				ts.ScriptKind.TS
			);

			// Find and parse the exported declaration
			const result = findAndParseTsdoc(sourceFile);

			// Compare with expected (normalize to match JSON serialization)
			assert.deepEqual(
				normalizeJson(result),
				normalizeJson(fixture.expected),
				`Fixture "${fixture.name}" failed`
			);
		}
	});

	test('all fixtures have valid structure', () => {
		for (const fixture of fixtures) {
			if (fixture.expected !== null) {
				validateTsdocStructure(fixture.expected);
			}
		}
	});
});

describe('cleanComment', () => {
	test.each([
		['basic JSDoc', '/** Hello world */', 'Hello world'],
		['single-line JSDoc', '/** Single line comment */', 'Single line comment'],
		['multiline JSDoc', '/**\n * First line.\n * Second line.\n */', 'First line.\nSecond line.'],
		['no space after asterisk', '/**\n *No space here\n */', 'No space here']
	])('%s', (_label, input, expected) => {
		assert.strictEqual(cleanComment(input), expected);
	});

	test.each([
		['empty comment', '/***/'],
		['only asterisks', '/**\n *\n */']
	])('returns undefined for %s', (_label, input) => {
		assert.isUndefined(cleanComment(input));
	});

	test('preserves indentation within content', () => {
		const result = cleanComment('/**\n * Example:\n *   indented code\n *   more code\n */');
		assert.strictEqual(result, 'Example:\n  indented code\n  more code');
	});

	test('handles JSDoc with tags', () => {
		const result = cleanComment(
			'/**\n * Description here.\n * @param x - the value\n * @returns something\n */'
		);
		assert.strictEqual(result, 'Description here.\n@param x - the value\n@returns something');
	});

	test('handles Windows line endings', () => {
		const result = cleanComment('/**\r\n * Line one.\r\n * Line two.\r\n */');
		assert.strictEqual(
			result,
			'Line one.\nLine two.',
			'Should normalize CRLF to LF without leaking \\r'
		);
	});

	test('handles trailing whitespace', () => {
		const result = cleanComment('/** text   */');
		assert.strictEqual(result, 'text');
	});

	test('single-asterisk block comment is not stripped', () => {
		// cleanComment only strips /** (JSDoc), not /* (regular block comments)
		const result = cleanComment('/* not JSDoc */');
		// The /** regex doesn't match /*, so the /* prefix remains in output
		assert.strictEqual(result, '/* not JSDoc');
	});
});

describe('parseComment module-comment filtering', () => {
	test('module comment attached to the first statement is not its own JSDoc', () => {
		// The AST attaches a file's module comment to the first statement —
		// parseComment must not read it (including its @nodocs) as statement docs
		const result = parseFirstStatement(
			'/**\n * Module docs.\n *\n * @module\n * @nodocs\n */\n\nexport {foo} from "./a.js";\n'
		);
		assert.isUndefined(result);
	});

	test('own JSDoc below a module comment still applies', () => {
		const result = parseFirstStatement(
			'/**\n * Module docs.\n *\n * @module\n * @nodocs\n */\n\n/** Own docs. */\nexport const foo = 1;\n'
		);
		assert.ok(result);
		assert.strictEqual(result.text, 'Own docs.');
		assert.notOk(result.nodocs);
	});
});

describe('parseComment tag spelling synonyms', () => {
	test('`@defaultValue` (TSDoc) and `@defaultvalue` (JSDoc synonym) parse like `@default`', () => {
		for (const spelling of ['default', 'defaultValue', 'defaultvalue']) {
			const result = parseFirstStatement(
				`/**\n * Docs.\n *\n * @${spelling} 42\n */\nexport let foo = 42;\n`
			);
			assert.ok(result, `expected a parsed comment for @${spelling}`);
			assert.strictEqual(result.defaultValue, '42', `@${spelling} did not populate defaultValue`);
		}
	});

	test('`@return` (JSDoc synonym) parses like `@returns`', () => {
		const result = parseFirstStatement(
			'/**\n * Docs.\n *\n * @return the answer\n */\nexport const foo = (): number => 42;\n'
		);
		assert.ok(result);
		assert.strictEqual(result.returns, 'the answer');
	});
});
