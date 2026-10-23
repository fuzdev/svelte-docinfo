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

import {
	cleanComment,
	jsdocParamTagDefault,
	parseComment,
	parseCommentText,
	parseModuleComment,
	toModuleDocFields
} from '#lib/tsdoc.ts';

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

	test('a mid-line `@module` mention leaves the block a declaration doc', () => {
		const result = parseFirstStatement(
			'/**\n * Reads an HTML `<!-- @module -->` comment.\n *\n * @since 1.0.0\n */\nexport const d = 1;\n'
		);
		assert.ok(result);
		// a declaration's JSDoc follows TypeScript, whose tag starts at the
		// mid-line `@`, so the text stops there; the block stays the declaration's
		assert.strictEqual(result.text, 'Reads an HTML `<!--');
		assert.strictEqual(result.since, '1.0.0');
	});

	test('a `@module` after a second `*` margin is not line-leading, as in `cleanComment`', () => {
		for (const block of ['/**\n * Docs.\n * * @module\n */', '/**\n * Docs.\n ** @module\n */']) {
			const result = parseFirstStatement(`${block}\nexport const d = 1;\n`);
			// the declaration keeps its doc; the text ends where TypeScript starts the tag
			assert.ok(result?.text.startsWith('Docs.'), block);
		}
	});

	test('a line-leading `@module` makes a module block, indented or on the opener line', () => {
		for (const block of [
			'/** @module */',
			'/**\n * Docs.\n *   @module\n */',
			'/**\n@module\n*/'
		]) {
			assert.isUndefined(parseFirstStatement(`${block}\nexport const d = 1;\n`), block);
		}
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

describe('parseComment inline links', () => {
	test('keeps each `{@link}` as written, targets that are not entity names included', () => {
		const result = parseFirstStatement(
			'/**\n * a {@link ./b.ts} c {@link} d {@link E} f {@link https://fuz.dev g}\n *\n * @see {@link ./h.ts}\n * @since {@link ./i.ts}\n */\nexport const a = (): number => 1;\n'
		);
		assert.ok(result);
		assert.strictEqual(
			result.text,
			'a {@link ./b.ts} c {@link} d {@link E} f {@link https://fuz.dev g}'
		);
		assert.deepStrictEqual(result.seeAlso, ['{@link ./h.ts}']);
		assert.strictEqual(result.since, '{@link ./i.ts}');
	});

	test('joins a link that spans lines onto one', () => {
		const result = parseFirstStatement('/**\n * a {@link B\n * c} d\n */\nexport const a = 1;\n');
		assert.strictEqual(result?.text, 'a {@link B c} d');
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

describe('jsdocParamTagDefault', () => {
	/** The bracket default of `tagText`, the one `@param` tag on a JS function's JSDoc. */
	const defaultOf = (tagText: string): string | undefined => {
		const sourceFile = ts.createSourceFile(
			'mod.js',
			`/**\n * ${tagText}\n */\nexport function fn(a) {}\n`,
			ts.ScriptTarget.Latest,
			true,
			ts.ScriptKind.JS
		);
		const tag = ts.getJSDocTags(sourceFile.statements[0]!).find(ts.isJSDocParameterTag);
		assert.ok(tag, `expected a @param tag in ${tagText}`);
		return jsdocParamTagDefault(tag, sourceFile);
	};

	test('slices the written default verbatim', () => {
		assert.strictEqual(defaultOf('@param {number} [a=0] - d'), '0');
		assert.strictEqual(defaultOf('@param {string} [a = "b c"] - d'), '"b c"');
		assert.strictEqual(defaultOf('@param [a=0] {number} d'), '0');
	});

	test('skips brackets and quoted brackets inside the default', () => {
		assert.strictEqual(defaultOf('@param [a=[1, [2]]] - d'), '[1, [2]]');
		assert.strictEqual(defaultOf("@param [a='b]'] - d"), "'b]'");
		assert.strictEqual(defaultOf("@param [a='b\\'] ]'] - d"), "'b\\'] ]'");
		assert.strictEqual(defaultOf('@param [a={ b: () => 1 }] - d'), '{ b: () => 1 }');
	});

	test('drops the JSDoc margin from a multi-line default', () => {
		assert.strictEqual(defaultOf('@param [a={\n *   x: 1\n * }] - d'), '{\n  x: 1\n}');
	});

	test('reads a regex literal containing `]` short (a named limit)', () => {
		assert.strictEqual(defaultOf('@param [a=/]/] - d'), '/');
	});

	test('returns undefined without a written default', () => {
		assert.strictEqual(defaultOf('@param {number} [a] - d'), undefined);
		assert.strictEqual(defaultOf('@param {number} a - d'), undefined);
		assert.strictEqual(defaultOf('@param {number} [a=] - d'), undefined);
	});
});

describe('parseComment nested @param tags', () => {
	test('property tags under a braced `{object}` parent key by their full name', () => {
		const result = parseFirstStatement(
			[
				'/**',
				' * @param {object} a - d1',
				' * @param {object} a.b - d2',
				' * @param {string} a.b.c - d3',
				' * @param {object[]} d - d4',
				' * @param {string} d[].e - d5',
				' */',
				'export function fn(a: unknown, d: unknown): void {}'
			].join('\n')
		);
		assert.ok(result);
		assert.deepEqual(
			{ ...result.params },
			{ a: 'd1', 'a.b': 'd2', 'a.b.c': 'd3', d: 'd4', 'd[].e': 'd5' }
		);
	});
});

describe('parseCommentText', () => {
	test('parses the same as the JSDoc block the text came from', () => {
		const block = [
			'/**',
			' * Docs with {@link a} and a list:',
			' *',
			' * - a',
			' *   - b',
			' *',
			' * @example',
			' * ```ts',
			' * fn({',
			' * \ta: 1',
			' * });',
			' * ```',
			' * @see https://fuz.dev/a',
			' *   continued',
			' * @see {@link b}',
			' * @throws {Error} when it fails',
			' * @mutates a - Description 1',
			' * @internal',
			' * @since 1.0.0',
			' */'
		].join('\n');
		const fromNode = parseFirstStatement(`${block}\nexport const a = 1;\n`);
		const fromText = parseCommentText(cleanComment(block)!);
		assert.ok(fromNode);
		assert.deepStrictEqual(fromText, fromNode);
		assert.deepStrictEqual(fromText?.seeAlso, ['https://fuz.dev/a continued', '{@link b}']);
	});

	test('restores a `*/` in the text, in prose and tags alike', () => {
		const result = parseCommentText('a */ b\n\n@see c */ d\n@example\n/* e */');
		assert.ok(result);
		assert.strictEqual(result.text, 'a */ b');
		assert.deepStrictEqual(result.seeAlso, ['c */ d']);
		assert.deepStrictEqual(result.examples, ['/* e */']);
	});

	test('a mid-line `@` stays text, where TypeScript would start a tag', () => {
		const result = parseCommentText('a `// @b c` d\ne @> f\n\n@see g @h {@link i}');
		assert.ok(result);
		assert.strictEqual(result.text, 'a `// @b c` d\ne @> f');
		assert.deepStrictEqual(result.seeAlso, ['g @h {@link i}']);
	});

	test('escape placeholders never collide with private-use characters in the text', () => {
		const text = `a ${String.fromCharCode(0xe000)} ${String.fromCharCode(0xe001)} b @ c */ d`;
		const result = parseModuleComment(`${text}\n@module`);
		assert.strictEqual(result?.text, text);
	});

	test('text with a `@module` line parses to undefined, like a module block on a node', () => {
		assert.isUndefined(parseCommentText('Docs.\n@module'));
	});
});

describe('parseModuleComment', () => {
	test('drops `@module` lines, renames included, keeping prose after them', () => {
		const result = parseModuleComment('@module custom-name\nDocs.\n\n@since 1.0.0');
		assert.ok(result);
		assert.strictEqual(result.text, 'Docs.');
		assert.strictEqual(result.since, '1.0.0');
	});

	test('a bare `@module` parses to undefined', () => {
		assert.isUndefined(parseModuleComment('@module'));
	});

	test('a tag-only comment parses, with empty prose', () => {
		const result = parseModuleComment('@see https://fuz.dev\n@module');
		assert.ok(result);
		assert.strictEqual(result.text, '');
		assert.deepStrictEqual(toModuleDocFields(result), { seeAlso: ['https://fuz.dev'] });
	});

	test('toModuleDocFields keeps only the tags a module carries', () => {
		const result = parseModuleComment(
			'Docs.\n\n@param a - b\n@returns c\n@throws {Error} d\n@mutates e - f\n@default 1\n@nodocs\n@deprecated\n@module'
		);
		assert.ok(result);
		assert.deepStrictEqual(toModuleDocFields(result), {
			moduleComment: 'Docs.',
			deprecatedMessage: ''
		});
	});
});
