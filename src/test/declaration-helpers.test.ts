/**
 * Tests for declaration-helpers.ts utility functions.
 *
 * These tests cover:
 * - getDisplayName - formatting declaration names with generics
 * - generateImport - generating TypeScript import statements
 * - compactReplacer - compact JSON serialization
 * - isKind - type narrowing for DeclarationJson and MemberJson
 * - typeJsonToTokens - flattening TypeJson trees into render-ready tokens
 * - typeJsonToText - the concatenated plain-text form
 */

import { readFileSync } from 'node:fs';
import { globSync } from 'tinyglobby';
import { test, assert, describe } from 'vitest';
import { ZodError } from 'zod';

import {
	DeclarationJson,
	MemberJson,
	type ConstructorMemberJson,
	ModuleJson,
	TypeJson
} from '$lib/types.ts';
import {
	getDisplayName,
	generateImport,
	compactReplacer,
	isKind,
	typeJsonToTokens,
	typeJsonToText,
	type TypeJsonToken
} from '$lib/declaration-helpers.ts';
import { AnalyzeResultJson } from '$lib/analyze-core.ts';

const d = (input: { name?: string; kind: string; [key: string]: unknown }): DeclarationJson =>
	DeclarationJson.parse(input);

describe('getDisplayName', () => {
	describe('non-generic declarations', () => {
		test('returns name for function without generics', () => {
			const declaration = d({
				name: 'add',
				kind: 'function'
			});

			const result = getDisplayName(declaration);

			assert.strictEqual(result, 'add');
		});

		test('returns name for type without generics', () => {
			const declaration = d({
				name: 'Config',
				kind: 'type'
			});

			const result = getDisplayName(declaration);

			assert.strictEqual(result, 'Config');
		});

		test('returns name for class without generics', () => {
			const declaration = d({
				name: 'Service',
				kind: 'class'
			});

			const result = getDisplayName(declaration);

			assert.strictEqual(result, 'Service');
		});

		test('returns name for variable', () => {
			const declaration = d({
				name: 'VERSION',
				kind: 'variable'
			});

			const result = getDisplayName(declaration);

			assert.strictEqual(result, 'VERSION');
		});

		test('returns name for component', () => {
			const declaration = d({
				name: 'Button',
				kind: 'component'
			});

			const result = getDisplayName(declaration);

			assert.strictEqual(result, 'Button');
		});

		test('returns name when genericParams is empty array', () => {
			const declaration = d({
				name: 'Simple',
				kind: 'type',
				genericParams: []
			});

			const result = getDisplayName(declaration);

			assert.strictEqual(result, 'Simple');
		});
	});

	describe('generic declarations', () => {
		test('formats single generic parameter', () => {
			const declaration = d({
				name: 'Container',
				kind: 'type',
				genericParams: [{ name: 'T' }]
			});

			const result = getDisplayName(declaration);

			assert.strictEqual(result, 'Container<T>');
		});

		test('formats multiple generic parameters', () => {
			const declaration = d({
				name: 'Map',
				kind: 'type',
				genericParams: [{ name: 'K' }, { name: 'V' }]
			});

			const result = getDisplayName(declaration);

			assert.strictEqual(result, 'Map<K, V>');
		});

		test('formats generic with constraint', () => {
			const declaration = d({
				name: 'KeyOf',
				kind: 'type',
				genericParams: [{ name: 'T', constraint: 'object' }]
			});

			const result = getDisplayName(declaration);

			assert.strictEqual(result, 'KeyOf<T extends object>');
		});

		test('formats generic with default type', () => {
			const declaration = d({
				name: 'Optional',
				kind: 'type',
				genericParams: [{ name: 'T', defaultType: 'unknown' }]
			});

			const result = getDisplayName(declaration);

			assert.strictEqual(result, 'Optional<T = unknown>');
		});

		test('formats generic with both constraint and default', () => {
			const declaration = d({
				name: 'Bounded',
				kind: 'type',
				genericParams: [{ name: 'T', constraint: 'string', defaultType: '"default"' }]
			});

			const result = getDisplayName(declaration);

			assert.strictEqual(result, 'Bounded<T extends string = "default">');
		});

		test('formats multiple generics with mixed constraints', () => {
			const declaration = d({
				name: 'Complex',
				kind: 'type',
				genericParams: [
					{ name: 'K', constraint: 'string' },
					{ name: 'V' },
					{ name: 'R', defaultType: 'void' }
				]
			});

			const result = getDisplayName(declaration);

			assert.strictEqual(result, 'Complex<K extends string, V, R = void>');
		});

		test('formats generic function', () => {
			const declaration = d({
				name: 'identity',
				kind: 'function',
				genericParams: [{ name: 'T' }]
			});

			const result = getDisplayName(declaration);

			assert.strictEqual(result, 'identity<T>');
		});

		test('formats generic class', () => {
			const declaration = d({
				name: 'Stack',
				kind: 'class',
				genericParams: [{ name: 'T' }]
			});

			const result = getDisplayName(declaration);

			assert.strictEqual(result, 'Stack<T>');
		});
	});
});

describe('generateImport', () => {
	// [label, name, kind, modulePath, libraryName, expected]
	const TYPE_IMPORT_CASES: Array<[string, string, string, string, string, string]> = [
		[
			'type import for type declaration',
			'Config',
			'type',
			'config.ts',
			'@my/lib',
			"import type {Config} from '@my/lib/config.js';"
		],
		[
			'type import for interface-like type',
			'Options',
			'type',
			'utils/options.ts',
			'@pkg/core',
			"import type {Options} from '@pkg/core/utils/options.js';"
		],
		[
			'type import for interface declaration',
			'Config',
			'interface',
			'config.ts',
			'@my/lib',
			"import type {Config} from '@my/lib/config.js';"
		]
	];

	const VALUE_IMPORT_CASES: Array<[string, string, string, string, string, string]> = [
		[
			'value import for function',
			'add',
			'function',
			'math.ts',
			'@my/lib',
			"import {add} from '@my/lib/math.js';"
		],
		[
			'value import for variable',
			'VERSION',
			'variable',
			'constants.ts',
			'@my/lib',
			"import {VERSION} from '@my/lib/constants.js';"
		],
		[
			'value import for class',
			'Service',
			'class',
			'service.ts',
			'@my/lib',
			"import {Service} from '@my/lib/service.js';"
		],
		[
			'default import for component',
			'Button',
			'component',
			'Button.svelte',
			'@my/ui',
			"import Button from '@my/ui/Button.svelte';"
		]
	];

	const DEFAULT_EXPORT_CASES: Array<[string, string, string, string, string]> = [
		[
			'PascalCase from simple module name',
			'function',
			'helper.ts',
			'@my/lib',
			"import Helper from '@my/lib/helper.js';"
		],
		[
			'PascalCase from kebab-case name',
			'class',
			'my-component.ts',
			'@my/lib',
			"import MyComponent from '@my/lib/my-component.js';"
		],
		[
			'PascalCase from camelCase name',
			'function',
			'stringUtils.ts',
			'@my/lib',
			"import StringUtils from '@my/lib/stringUtils.js';"
		],
		[
			'default Svelte component',
			'component',
			'Button.svelte',
			'@my/ui',
			"import Button from '@my/ui/Button.svelte';"
		],
		[
			'default from JS file',
			'function',
			'helper.js',
			'@my/lib',
			"import Helper from '@my/lib/helper.js';"
		],
		[
			'PascalCase from nested path',
			'variable',
			'utils/helpers.ts',
			'@pkg/lib',
			"import UtilsHelpers from '@pkg/lib/utils/helpers.js';"
		]
	];

	const PATH_HANDLING_CASES: Array<[string, string, string, string, string, string]> = [
		[
			'converts .ts to .js',
			'foo',
			'function',
			'utils.ts',
			'@my/lib',
			"import {foo} from '@my/lib/utils.js';"
		],
		[
			'handles nested paths',
			'deep',
			'function',
			'a/b/c/deep.ts',
			'@my/lib',
			"import {deep} from '@my/lib/a/b/c/deep.js';"
		],
		[
			'preserves .svelte extension',
			'Card',
			'component',
			'Card.svelte',
			'@my/ui',
			"import Card from '@my/ui/Card.svelte';"
		],
		[
			'handles scoped packages',
			'util',
			'function',
			'util.ts',
			'@scope/package',
			"import {util} from '@scope/package/util.js';"
		],
		[
			'handles unscoped packages',
			'util',
			'function',
			'util.ts',
			'my-package',
			"import {util} from 'my-package/util.js';"
		]
	];

	describe('type imports', () => {
		test.each(TYPE_IMPORT_CASES)('%s', (_label, name, kind, modulePath, lib, expected) => {
			assert.strictEqual(generateImport(d({ name, kind }), modulePath, lib), expected);
		});
	});

	describe('value imports', () => {
		test.each(VALUE_IMPORT_CASES)('%s', (_label, name, kind, modulePath, lib, expected) => {
			assert.strictEqual(generateImport(d({ name, kind }), modulePath, lib), expected);
		});
	});

	describe('merged value+type declarations', () => {
		test('merged type gets a value import, not import type', () => {
			assert.strictEqual(
				generateImport(
					d({ name: 'Config', kind: 'type', mergedValue: true }),
					'config.ts',
					'@my/lib'
				),
				"import {Config} from '@my/lib/config.js';"
			);
		});

		test('merged interface gets a value import, not import type', () => {
			assert.strictEqual(
				generateImport(
					d({ name: 'Config', kind: 'interface', mergedValue: true }),
					'config.ts',
					'@my/lib'
				),
				"import {Config} from '@my/lib/config.js';"
			);
		});
	});

	describe('default exports', () => {
		test.each(DEFAULT_EXPORT_CASES)('%s', (_label, kind, modulePath, lib, expected) => {
			// Default-slot entries are named `'default'` (the symbol's actual name in
			// JS); the import binding is derived by PascalCasing the module path.
			assert.strictEqual(generateImport(d({ name: 'default', kind }), modulePath, lib), expected);
		});

		test('default-slot entry uses PascalCased module name', () => {
			assert.strictEqual(
				generateImport(d({ name: 'default', kind: 'function' }), 'a.ts', '@pkg/lib'),
				"import A from '@pkg/lib/a.js';"
			);
		});

		test('default-slot entry with kebab-case path uses PascalCased binding', () => {
			assert.strictEqual(
				generateImport(d({ name: 'default', kind: 'function' }), 'foo-bar.ts', '@pkg/lib'),
				"import FooBar from '@pkg/lib/foo-bar.js';"
			);
		});
	});

	describe('path and library name handling', () => {
		test.each(PATH_HANDLING_CASES)('%s', (_label, name, kind, modulePath, lib, expected) => {
			assert.strictEqual(generateImport(d({ name, kind }), modulePath, lib), expected);
		});
	});
});

describe('compactReplacer', () => {
	const serialize = (value: unknown): unknown => JSON.parse(JSON.stringify(value, compactReplacer));

	test('strips empty arrays from objects', () => {
		const result = serialize({ name: 'foo', declarations: [] });

		assert.deepStrictEqual(result, { name: 'foo' });
	});

	test('preserves non-empty arrays', () => {
		const result = serialize({ name: 'foo', declarations: [{ name: 'bar' }] });

		assert.deepStrictEqual(result, { name: 'foo', declarations: [{ name: 'bar' }] });
	});

	test('strips nested empty arrays', () => {
		const result = serialize({ outer: [{ inner: [] }] });

		assert.deepStrictEqual(result, { outer: [{}] });
	});

	test('preserves non-array primitives', () => {
		const result = serialize({ str: 'hello', num: 42, bool: true, nil: null });

		assert.deepStrictEqual(result, { str: 'hello', num: 42, bool: true, nil: null });
	});

	test('preserves non-empty nested arrays', () => {
		const result = serialize({ tags: ['a', 'b'], empty: [] });

		assert.deepStrictEqual(result, { tags: ['a', 'b'] });
	});

	test('strips false booleans', () => {
		const result = serialize({ name: 'foo', active: false, visible: true });

		assert.deepStrictEqual(result, { name: 'foo', visible: true });
	});

	test('strips empty array and false at the root', () => {
		// Root-value behavior is documented: array-rooted callers (Vite plugin)
		// must handle the empty case themselves before calling. `JSON.stringify`
		// returns the JS `undefined` (literal `'undefined'` string from the
		// stringify call, not the JS value — confusingly, `String(undefined)`
		// is the literal `"undefined"` text in some contexts but `JSON.stringify`
		// itself returns the JS `undefined`). The vite plugin's `updateOutputFromQuery`
		// short-circuits to the literal `'[]'` for empty `modules` arrays.
		assert.strictEqual(JSON.stringify([], compactReplacer), undefined);
		assert.strictEqual(JSON.stringify(false, compactReplacer), undefined);
	});

	test('round-trips DeclarationJson through Zod parse', () => {
		const original = d({ name: 'test', kind: 'function' });
		const json = JSON.stringify(original, compactReplacer);
		const restored = DeclarationJson.parse(JSON.parse(json));

		// Empty arrays should be restored by Zod .default([])
		assert.deepStrictEqual(restored.genericParams, []);
		assert.deepStrictEqual(restored.alsoExportedFrom, []);
		assert.strictEqual(restored.name, 'test');
	});

	test('every z.boolean().default in types.ts uses false (locks compactReplacer invariant)', () => {
		// `compactReplacer` strips `value === false` for every boolean it sees,
		// which is only safe round-trip-wise if every boolean in the schema
		// defaults to `false` (Zod restores the default on `.parse()`).
		// A `z.boolean().default(true)` would silently break round-tripping:
		// compact serialization drops the `false` value, then `.parse()` restores
		// the schema default `true`. This test catches that at the source level.
		const typesUrl = new URL('../lib/types.ts', import.meta.url);
		const source = readFileSync(typesUrl, 'utf-8');
		// Strip block + line comments so JSDoc examples don't trigger false positives
		const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
		const matches = Array.from(code.matchAll(/z\.boolean\(\)\.default\(([^)]+)\)/g));
		assert.ok(
			matches.length > 0,
			'Expected at least one z.boolean().default(...) in types.ts (regex broke?)'
		);
		const violations = matches.map((m) => m[1]!.trim()).filter((arg) => arg !== 'false');
		assert.deepStrictEqual(
			violations,
			[],
			`Found ${violations.length} z.boolean().default(...) call(s) with non-false default: ${violations.join(', ')}. ` +
				`compactReplacer in declaration-helpers.ts strips every false boolean from compact output, ` +
				`which only round-trips correctly when every defaulted boolean defaults to false. ` +
				`Either change the default to false, or extend compactReplacer + this test.`
		);
	});

	test('round-trips full ModuleJson through Zod parse', () => {
		const original = [
			ModuleJson.parse({
				path: 'utils.ts',
				declarations: [
					{
						name: 'add',
						kind: 'function',
						parameters: [{ name: 'a', type: 'number' }],
						returnType: 'number'
					},
					{ name: 'Config', kind: 'interface', members: [{ name: 'debug', kind: 'variable' }] },
					{ name: 'VERSION', kind: 'variable', typeSignature: 'string' }
				],
				moduleComment: 'Utility module.',
				dependencies: ['core.ts'],
				starExports: ['helpers.ts']
			})
		];

		const json = JSON.stringify(original, compactReplacer);
		const restored = (JSON.parse(json) as Array<unknown>).map((m) => ModuleJson.parse(m));

		assert.strictEqual(restored[0]!.path, 'utils.ts');
		assert.strictEqual(restored[0]!.declarations.length, 3);
		assert.strictEqual(restored[0]!.moduleComment, 'Utility module.');
		assert.deepStrictEqual(restored[0]!.dependencies, ['core.ts']);
		assert.deepStrictEqual(restored[0]!.starExports, ['helpers.ts']);
		// Zod restores defaults stripped by compact serialization
		assert.deepStrictEqual(restored[0]!.dependents, []);
		assert.deepStrictEqual(restored[0]!.declarations[0]!.alsoExportedFrom, []);
	});

	test('parse → stringify(compactReplacer) → parse is a faithful round-trip across every variant', () => {
		// Stricter than the tests above. The source-regex test
		// (`every z.boolean().default in types.ts uses false`) catches *new*
		// `.default(true)` violations, but it doesn't catch:
		//   - removing a `.default(false)` on an existing field (now required;
		//     compact strips `false`, parse rejects)
		//   - removing a `.default([])` on an array field (compact strips `[]`,
		//     parse fills nothing → field becomes undefined where it was `[]`)
		//   - adding a new field whose runtime value compactReplacer drops but
		//     Zod doesn't restore
		// Whole-shape diff after a real round-trip catches all of these.
		//
		// Coverage: every declaration variant (9), every member variant (3),
		// and the leaf shapes (`ParameterJson`, `OverloadJson`,
		// `ComponentPropJson`, `GenericParamJson`). Each variant populates at
		// least one optional and one defaulted field so a regression on any
		// of them surfaces.
		const fixture = [
			ModuleJson.parse({
				path: 'comprehensive.ts',
				declarations: [
					// FunctionDeclarationJson — overloads, doc fields, generic params, mutates, partial
					{
						name: 'fn',
						kind: 'function',
						docComment: 'Description.',
						typeSignature: '<T>(a: T, b?: number, ...rest: string[]): T',
						modifiers: [],
						sourceLine: 10,
						genericParams: [{ name: 'T', constraint: 'string', defaultType: 'unknown' }],
						examples: ['fn("x")'],
						deprecatedMessage: 'Use fn2.',
						seeAlso: ['fn2', '{@link https://fuz.dev}'],
						throws: [
							{ type: 'TypeError', description: 'on bad input' },
							{ description: 'generic' }
						],
						since: '1.0.0',
						mutates: { a: 'mutated', 'this.foo': 'compound path' },
						partial: false,
						parameters: [
							{ name: 'a', type: 'T', description: 'first' },
							{ name: 'b', type: 'number', optional: true },
							{ name: 'rest', type: 'string[]', rest: true }
						],
						overloads: [
							{
								typeSignature: '(a: string): string',
								parameters: [{ name: 'a', type: 'string' }],
								returnType: 'string',
								genericParams: [],
								docComment: 'String form.'
							}
						],
						returnType: 'T',
						returnDescription: 'echo',
						alsoExportedFrom: ['barrel.ts']
					},
					// ClassDeclarationJson — implements, extends, members (all 3 kinds)
					{
						name: 'A',
						kind: 'class',
						modifiers: ['readonly'],
						extends: 'B',
						implements: ['I1', 'I2'],
						members: [
							{
								name: 'constructor',
								kind: 'constructor',
								parameters: [{ name: 'x', type: 'number' }],
								overloads: []
							},
							{
								name: 'method',
								kind: 'function',
								parameters: [],
								returnType: 'void',
								optional: false
							},
							{
								name: 'field',
								kind: 'variable',
								typeSignature: 'string',
								optional: false,
								reactivity: '$state'
							}
						]
					},
					// InterfaceDeclarationJson — extends list, members with optional `?`,
					// plus a `(construct)` construct-signature member exercising the
					// `ConstructorMemberJson.name` literal-union narrow
					// (`'constructor' | '(construct)'`).
					{
						name: 'I1',
						kind: 'interface',
						extends: ['Base1', 'Base2'],
						members: [
							{ name: 'maybe', kind: 'variable', typeSignature: 'string', optional: true },
							{
								name: 'method',
								kind: 'function',
								parameters: [],
								returnType: 'void',
								optional: true
							},
							{
								name: '(construct)',
								kind: 'constructor',
								typeSignature: 'new (x: number) => I1',
								parameters: [{ name: 'x', type: 'number' }],
								overloads: []
							}
						]
					},
					// TypeDeclarationJson — externalTypes, members
					{
						name: 'T1',
						kind: 'type',
						typeSignature: '{a: string} & External',
						externalTypes: ['External'],
						members: [{ name: 'a', kind: 'variable', typeSignature: 'string', optional: false }]
					},
					// VariableDeclarationJson — reactivity, plus a typeInfo tree with a
					// registry-recovered (module-carrying) reference
					{
						name: 'count',
						kind: 'variable',
						typeSignature: 'number',
						reactivity: '$state',
						typeInfo: {
							kind: 'union',
							members: [
								{ kind: 'reference', name: 'Lost', module: 'schemas.ts' },
								{ kind: 'intrinsic', text: 'null' }
							]
						}
					},
					// EnumDeclarationJson — members
					{
						name: 'E',
						kind: 'enum',
						members: [
							{ name: 'A', kind: 'variable', optional: false },
							{ name: 'B', kind: 'variable', optional: false }
						]
					},
					// ComponentDeclarationJson — props, acceptsChildren, lang, externalTypes
					{
						name: 'C',
						kind: 'component',
						lang: 'js',
						acceptsChildren: true,
						externalTypes: ['HTMLAttributes<HTMLDivElement>'],
						props: [
							{ name: 'value', type: 'string', description: 'Description' },
							{
								name: 'onChange',
								type: '(v: string) => void',
								optional: true,
								bindable: false,
								examples: ['onChange={(v) => console.log(v)}']
							},
							{
								name: 'binding',
								type: 'string',
								bindable: true,
								optional: false
							},
							{
								name: 'children',
								type: 'Snippet<[item: string]>',
								optional: true,
								parameters: [{ name: 'item', type: 'string' }]
							}
						]
					},
					// SnippetDeclarationJson — parameters
					{
						name: 'greet',
						kind: 'snippet',
						typeSignature: 'Snippet<[name: string]>',
						parameters: [{ name: 'name', type: 'string' }]
					},
					// NamespaceDeclarationJson — module pointer
					{ name: 'ns', kind: 'namespace', module: 'inner.ts' },
					// Default-slot entry — name === 'default', partial extraction
					{
						name: 'default',
						kind: 'function',
						partial: true,
						parameters: [],
						returnType: 'void'
					},
					// Aliased entry — exercises aliasOf shape with named canonical
					{
						name: 'Renamed',
						kind: 'function',
						aliasOf: { module: 'other.ts', name: 'Original' }
					},
					// Aliased entry — exercises aliasOf shape with default canonical
					{
						name: 'RenamedDefault',
						kind: 'function',
						aliasOf: { module: 'default-source.ts', name: 'default' }
					}
				],
				moduleComment: 'Module comment.',
				dependencies: ['inner.ts', 'other.ts'],
				dependents: ['consumer.ts'],
				starExports: ['barrel.ts']
			})
		];

		const json = JSON.stringify(fixture, compactReplacer);
		const restored = (JSON.parse(json) as Array<unknown>).map((m) => ModuleJson.parse(m));

		assert.deepStrictEqual(restored, fixture);
	});

	test('AnalyzeResultJson envelope round-trips through compactReplacer (both populated)', () => {
		const original = AnalyzeResultJson.parse({
			modules: [
				{
					path: 'utils.ts',
					declarations: [{ name: 'add', kind: 'function', returnType: 'number' }]
				}
			],
			diagnostics: [
				{
					kind: 'duplicate_declaration',
					file: 'utils.ts',
					message: 'Duplicate "add"',
					severity: 'warning',
					declarationName: 'add',
					modules: ['utils.ts', 'other.ts']
				}
			]
		});

		const json = JSON.stringify(original, compactReplacer);
		const restored = AnalyzeResultJson.parse(JSON.parse(json));

		assert.deepStrictEqual(restored, original);
	});

	test('AnalyzeResultJson envelope round-trips through compactReplacer (both empty)', () => {
		// Both arrays empty — wire form collapses to `{}`, schema restores `[]`.
		// This is the case the old CLI top-level carve-out worked around;
		// schema-validated round-trip makes the carve-out unnecessary.
		const original = AnalyzeResultJson.parse({ modules: [], diagnostics: [] });

		const json = JSON.stringify(original, compactReplacer);
		assert.strictEqual(json, '{}');

		const restored = AnalyzeResultJson.parse(JSON.parse(json));
		assert.deepStrictEqual(restored, original);
		assert.deepStrictEqual(restored.modules, []);
		assert.deepStrictEqual(restored.diagnostics, []);
	});

	test('AnalyzeResultJson envelope round-trips through compactReplacer (mixed empty)', () => {
		// Modules populated, diagnostics empty.
		const a = AnalyzeResultJson.parse({
			modules: [{ path: 'a.ts', declarations: [] }],
			diagnostics: []
		});
		const aJson = JSON.stringify(a, compactReplacer);
		assert.deepStrictEqual(AnalyzeResultJson.parse(JSON.parse(aJson)), a);

		// Modules empty, diagnostics populated.
		const b = AnalyzeResultJson.parse({
			modules: [],
			diagnostics: [
				{
					kind: 'module_skipped',
					file: 'b.ts',
					message: 'Skipped',
					severity: 'warning',
					reason: 'no_analyzer'
				}
			]
		});
		const bJson = JSON.stringify(b, compactReplacer);
		assert.deepStrictEqual(AnalyzeResultJson.parse(JSON.parse(bJson)), b);
	});
});

describe('isKind', () => {
	// [label, kind, expected]
	const DECLARATION_CASES: Array<[string, string, boolean]> = [
		['narrows function declarations', 'function', true],
		['narrows type declarations', 'type', true],
		['narrows class declarations', 'class', true],
		['narrows interface declarations', 'interface', true],
		['narrows variable declarations', 'variable', true],
		['narrows enum declarations', 'enum', true],
		['narrows component declarations', 'component', true]
	];

	describe('DeclarationJson narrowing', () => {
		test.each(DECLARATION_CASES)('%s', (_label, kind, expected) => {
			const declaration = d({ name: 'test', kind });
			assert.strictEqual(isKind(declaration, kind as 'function'), expected);
		});

		test('rejects mismatched kind', () => {
			const declaration = d({ name: 'test', kind: 'function' });
			assert.isFalse(isKind(declaration, 'class'));
		});

		test('provides type-safe field access after narrowing', () => {
			const declaration = d({
				name: 'add',
				kind: 'function',
				parameters: [{ name: 'a', type: 'number' }],
				returnType: 'number'
			});

			if (isKind(declaration, 'function')) {
				// TypeScript should allow accessing function-specific fields
				assert.strictEqual(declaration.parameters.length, 1);
				assert.strictEqual(declaration.returnType, 'number');
			} else {
				assert.fail('Expected function kind');
			}
		});

		test('provides type-safe access for class members', () => {
			const declaration = d({
				name: 'MyClass',
				kind: 'class',
				members: [{ name: 'method', kind: 'function' }]
			});

			if (isKind(declaration, 'class')) {
				assert.strictEqual(declaration.members.length, 1);
			} else {
				assert.fail('Expected class kind');
			}
		});

		test('provides type-safe access for interface members', () => {
			const declaration = d({
				name: 'MyInterface',
				kind: 'interface',
				members: [{ name: 'prop', kind: 'variable' }]
			});

			if (isKind(declaration, 'interface')) {
				assert.strictEqual(declaration.members.length, 1);
			} else {
				assert.fail('Expected interface kind');
			}
		});
	});

	describe('MemberJson narrowing', () => {
		const member = (input: { name: string; kind: string; [key: string]: unknown }): MemberJson =>
			MemberJson.parse(input);

		test('narrows function members', () => {
			const m = member({ name: 'method', kind: 'function' });
			assert.isTrue(isKind(m, 'function'));
			assert.isFalse(isKind(m, 'variable'));
		});

		test('narrows variable members', () => {
			const m = member({ name: 'prop', kind: 'variable' });
			assert.isTrue(isKind(m, 'variable'));
			assert.isFalse(isKind(m, 'function'));
		});

		test('narrows constructor members', () => {
			const m = member({ name: 'constructor', kind: 'constructor' });
			assert.isTrue(isKind(m, 'constructor'));
			assert.isFalse(isKind(m, 'function'));
		});

		test('constructor narrowed type has parameters field', () => {
			const m = member({
				name: 'constructor',
				kind: 'constructor',
				parameters: [{ name: 'x', type: 'number' }]
			});

			if (isKind(m, 'constructor')) {
				// ConstructorMemberJson type should provide access to parameters
				const _ctor: ConstructorMemberJson = m;
				assert.strictEqual(_ctor.parameters.length, 1);
			} else {
				assert.fail('Expected constructor kind');
			}
		});

		test('constructor accepts (construct) sentinel for interface/type construct signatures', () => {
			const m = member({ name: '(construct)', kind: 'constructor' });
			assert.isTrue(isKind(m, 'constructor'));
			if (isKind(m, 'constructor')) {
				assert.strictEqual(m.name, '(construct)');
			}
		});

		test('constructor rejects arbitrary name strings (literal-union narrow)', () => {
			assert.throws(() => member({ name: 'init', kind: 'constructor' }));
			assert.throws(() => member({ name: '', kind: 'constructor' }));
		});
	});
});

describe('typeJsonToTokens', () => {
	test('a bare reference is a single name token', () => {
		const tokens = typeJsonToTokens({ kind: 'reference', name: 'A' });
		assert.deepStrictEqual(tokens, [{ kind: 'name', name: 'A' }]);
	});

	test('a registry-recovered reference passes `module` through to its name token', () => {
		const node: TypeJson = { kind: 'reference', name: 'A', module: 'a.ts' };
		assert.deepStrictEqual(typeJsonToTokens(node), [{ kind: 'name', name: 'A', module: 'a.ts' }]);
		// module-less references stay module-less tokens — no `module: undefined` key
		const bare = typeJsonToTokens({ kind: 'reference', name: 'A' });
		assert.ok(bare[0] && !('module' in bare[0]));
		// `module` is link scoping, never rendered text
		assert.strictEqual(typeJsonToText(node), 'A');
	});

	test('a generic instantiation packs punctuation around recursive args', () => {
		const node: TypeJson = {
			kind: 'reference',
			name: 'Map',
			typeArgs: [
				{ kind: 'intrinsic', text: 'string' },
				{ kind: 'reference', name: 'A' }
			]
		};
		const tokens = typeJsonToTokens(node);
		assert.deepStrictEqual(tokens, [
			{ kind: 'name', name: 'Map' },
			{ kind: 'text', text: '<' },
			{ kind: 'code', text: 'string' },
			{ kind: 'text', text: ', ' },
			{ kind: 'name', name: 'A' },
			{ kind: 'text', text: '>' }
		]);
		assert.strictEqual(typeJsonToText(node), 'Map<string, A>');
	});

	test('union members separate with pipes and terminals stay code tokens', () => {
		const node: TypeJson = {
			kind: 'union',
			members: [
				{ kind: 'literal', value: 'a', text: '"a"' },
				{ kind: 'literal', value: 'b', text: '"b"' },
				{ kind: 'intrinsic', text: 'null' }
			]
		};
		assert.strictEqual(typeJsonToText(node), '"a" | "b" | null');
	});

	test('an alias-carrying union renders as its bare name', () => {
		const node: TypeJson = {
			kind: 'union',
			alias: 'E',
			members: [
				{ kind: 'literal', value: 'a', text: '"a"' },
				{ kind: 'literal', value: 'b', text: '"b"' }
			]
		};
		assert.deepStrictEqual(typeJsonToTokens(node), [{ kind: 'name', name: 'E' }]);
	});

	test('a nested alias-carrying union composes without parens', () => {
		const node: TypeJson = {
			kind: 'union',
			members: [
				{
					kind: 'union',
					alias: 'E',
					members: [{ kind: 'literal', value: 'a', text: '"a"' }]
				},
				{ kind: 'intrinsic', text: 'null' }
			]
		};
		assert.strictEqual(typeJsonToText(node), 'E | null');
	});

	test('function members parenthesize inside unions', () => {
		const node: TypeJson = {
			kind: 'union',
			members: [
				{ kind: 'function', text: '(x: string) => void' },
				{ kind: 'intrinsic', text: 'null' }
			]
		};
		assert.strictEqual(typeJsonToText(node), '((x: string) => void) | null');
	});

	test('arrays wrap union elements in parens and honor readonly', () => {
		const union: TypeJson = {
			kind: 'union',
			members: [
				{ kind: 'reference', name: 'A' },
				{ kind: 'intrinsic', text: 'null' }
			]
		};
		assert.strictEqual(typeJsonToText({ kind: 'array', element: union }), '(A | null)[]');
		assert.strictEqual(
			typeJsonToText({
				kind: 'array',
				element: { kind: 'intrinsic', text: 'string' },
				readonly: true
			}),
			'readonly string[]'
		);
	});

	test('a readonly array element parenthesizes inside an array', () => {
		// `readonly string[][]` denotes a readonly array of `string[]` — a
		// different type — so the element must parenthesize
		assert.strictEqual(
			typeJsonToText({
				kind: 'array',
				element: {
					kind: 'array',
					element: { kind: 'intrinsic', text: 'string' },
					readonly: true
				}
			}),
			'(readonly string[])[]'
		);
		assert.strictEqual(
			typeJsonToText({
				kind: 'array',
				element: {
					kind: 'tuple',
					elements: [{ name: 'a', type: { kind: 'intrinsic', text: 'string' } }],
					readonly: true
				}
			}),
			'(readonly [a: string])[]'
		);
	});

	test('a loose-binding terminal parenthesizes in composition', () => {
		// `keyof T[]` is `keyof (T[])` and a conditional's false branch would
		// swallow the `[]` — whitespace-carrying `other` text parenthesizes
		assert.strictEqual(
			typeJsonToText({
				kind: 'array',
				element: { kind: 'other', text: 'keyof T' }
			}),
			'(keyof T)[]'
		);
		assert.strictEqual(
			typeJsonToText({
				kind: 'union',
				members: [
					{ kind: 'other', text: 'T extends string ? A : B' },
					{ kind: 'intrinsic', text: 'null' }
				]
			}),
			'(T extends string ? A : B) | null'
		);
		// a bare type parameter stays unwrapped
		assert.strictEqual(
			typeJsonToText({ kind: 'array', element: { kind: 'other', text: 'T' } }),
			'T[]'
		);
	});

	test('intersections separate with ampersands', () => {
		const node: TypeJson = {
			kind: 'intersection',
			members: [
				{ kind: 'reference', name: 'A' },
				{ kind: 'reference', name: 'B' }
			]
		};
		assert.strictEqual(typeJsonToText(node), 'A & B');
	});

	test('an alias-carrying intersection renders as its bare name', () => {
		const node: TypeJson = {
			kind: 'intersection',
			alias: 'Merged',
			members: [
				{ kind: 'reference', name: 'A' },
				{ kind: 'reference', name: 'B' }
			]
		};
		assert.deepStrictEqual(typeJsonToTokens(node), [{ kind: 'name', name: 'Merged' }]);
	});

	test('a union type argument stays bare inside the angle brackets', () => {
		const node: TypeJson = {
			kind: 'reference',
			name: 'Map',
			typeArgs: [
				{
					kind: 'union',
					members: [
						{ kind: 'reference', name: 'A' },
						{ kind: 'reference', name: 'B' }
					]
				},
				{ kind: 'intrinsic', text: 'string' }
			]
		};
		assert.strictEqual(typeJsonToText(node), 'Map<A | B, string>');
	});

	test('a terminal root is a single code token', () => {
		assert.deepStrictEqual(typeJsonToTokens({ kind: 'object', text: '{ a: string; }' }), [
			{ kind: 'code', text: '{ a: string; }' }
		]);
	});

	test('tuples render labels, optional and rest markers', () => {
		const node: TypeJson = {
			kind: 'tuple',
			elements: [
				{ name: 'a', type: { kind: 'intrinsic', text: 'string' } },
				{ name: 'b', type: { kind: 'intrinsic', text: 'number' }, optional: true },
				{
					name: 'rest',
					type: { kind: 'array', element: { kind: 'intrinsic', text: 'boolean' } },
					rest: true
				}
			]
		};
		assert.strictEqual(typeJsonToText(node), '[a: string, b?: number, ...rest: boolean[]]');
	});

	test('an unnamed optional tuple element takes the postfix marker', () => {
		const node: TypeJson = {
			kind: 'tuple',
			elements: [{ type: { kind: 'intrinsic', text: 'string' }, optional: true }]
		};
		assert.strictEqual(typeJsonToText(node), '[string?]');
	});

	test('an unnamed optional element parenthesizes non-atomic types', () => {
		// the postfix `?` is valid only after an atomic type — `[() => void?]`
		// and `[string | number?]` are parse errors
		assert.strictEqual(
			typeJsonToText({
				kind: 'tuple',
				elements: [{ type: { kind: 'function', text: '() => void' }, optional: true }]
			}),
			'[(() => void)?]'
		);
		assert.strictEqual(
			typeJsonToText({
				kind: 'tuple',
				elements: [
					{
						type: {
							kind: 'union',
							members: [
								{ kind: 'intrinsic', text: 'string' },
								{ kind: 'intrinsic', text: 'number' }
							]
						},
						optional: true
					}
				]
			}),
			'[(string | number)?]'
		);
	});

	test('the empty tuple renders bare brackets', () => {
		assert.strictEqual(typeJsonToText({ kind: 'tuple' }), '[]');
	});

	test('a readonly tuple carries the modifier at the root', () => {
		assert.strictEqual(
			typeJsonToText({
				kind: 'tuple',
				elements: [{ name: 'a', type: { kind: 'intrinsic', text: 'string' } }],
				readonly: true
			}),
			'readonly [a: string]'
		);
	});

	test('unnamed rest and variadic elements compose after the spread', () => {
		// an unnamed rest element's type is already the collecting array
		assert.strictEqual(
			typeJsonToText({
				kind: 'tuple',
				elements: [
					{ type: { kind: 'array', element: { kind: 'intrinsic', text: 'string' } }, rest: true }
				]
			}),
			'[...string[]]'
		);
		// a variadic spread of an unresolved type carries the spread type itself
		assert.strictEqual(
			typeJsonToText({
				kind: 'tuple',
				elements: [
					{ name: 'a', type: { kind: 'intrinsic', text: 'string' } },
					{ type: { kind: 'other', text: 'T' }, rest: true }
				]
			}),
			'[a: string, ...T]'
		);
	});

	test('adjacent punctuation merges into single text tokens', () => {
		// `A[][]` — the inner array's `[]` and the outer's `[]` share one token
		const node: TypeJson = {
			kind: 'array',
			element: { kind: 'array', element: { kind: 'reference', name: 'A' } }
		};
		assert.deepStrictEqual(typeJsonToTokens(node), [
			{ kind: 'name', name: 'A' },
			{ kind: 'text', text: '[][]' }
		]);
	});
});

describe('typeJsonToText', () => {
	test('concatenates tokens into the printed form', () => {
		assert.strictEqual(
			typeJsonToText({
				kind: 'union',
				members: [
					{ kind: 'reference', name: 'A' },
					{ kind: 'intrinsic', text: 'null' }
				]
			}),
			'A | null'
		);
	});
});

describe('typeJsonToTokens over the fixture corpus', () => {
	// every `typeInfo`/`returnTypeInfo` tree committed in the fixture baselines —
	// binds the tokenizer to the shapes the analyzer actually emits, so a
	// projection change the hand-built literals above miss still fails here.
	// Roots only: nested nodes are exercised through tokenization recursion
	const collectTrees = (value: unknown, out: Array<unknown>): void => {
		if (Array.isArray(value)) {
			for (const v of value) collectTrees(v, out);
			return;
		}
		if (value === null || typeof value !== 'object') return;
		for (const [key, v] of Object.entries(value)) {
			if ((key === 'typeInfo' || key === 'returnTypeInfo') && v != null) out.push(v);
			collectTrees(v, out);
		}
	};

	test('every committed tree parses and tokenizes within invariants', () => {
		const files = globSync('src/test/fixtures/**/expected.json');
		const trees: Array<unknown> = [];
		for (const file of files) {
			collectTrees(JSON.parse(readFileSync(file, 'utf8')), trees);
		}
		// the walk finding nothing would pass vacuously — assert a floor
		assert.isAtLeast(trees.length, 10, 'expected the corpus walk to find trees');
		for (const raw of trees) {
			const tree = TypeJson.parse(raw);
			const tokens = typeJsonToTokens(tree);
			assert.isAbove(tokens.length, 0);
			let prev: TypeJsonToken | undefined;
			for (const token of tokens) {
				if (token.kind === 'text') {
					assert.notStrictEqual(token.text, '', 'empty text token');
					assert.notStrictEqual(prev?.kind, 'text', 'adjacent text tokens must merge');
				} else if (token.kind === 'name') {
					assert.notStrictEqual(token.name, '', 'empty name token');
				} else {
					assert.notStrictEqual(token.text, '', 'empty code token');
				}
				prev = token;
			}
			assert.notStrictEqual(typeJsonToText(tree), '', 'empty printed form');
		}
	});
});

describe('Zod schema validation', () => {
	test('ModuleJson rejects unknown keys (strictObject)', () => {
		assert.throws(() => ModuleJson.parse({ path: 'foo.ts', unknownField: true }), ZodError);
	});

	test('DeclarationJson rejects unknown keys (strictObject)', () => {
		assert.throws(
			() => DeclarationJson.parse({ name: 'foo', kind: 'function', unknownField: true }),
			ZodError
		);
	});

	test('DeclarationJson rejects invalid kind', () => {
		assert.throws(() => DeclarationJson.parse({ name: 'foo', kind: 'invalid' }), ZodError);
	});

	test('MemberJson rejects invalid kind', () => {
		assert.throws(() => MemberJson.parse({ name: 'foo', kind: 'class' }), ZodError);
	});

	test('InterfaceDeclarationJson rejects "properties" key', () => {
		assert.throws(
			() =>
				DeclarationJson.parse({
					name: 'A',
					kind: 'interface',
					properties: [{ name: 'a', kind: 'variable' }]
				}),
			ZodError
		);
	});

	test('TypeDeclarationJson rejects "properties" key', () => {
		assert.throws(
			() =>
				DeclarationJson.parse({
					name: 'A',
					kind: 'type',
					properties: [{ name: 'a', kind: 'variable' }]
				}),
			ZodError
		);
	});

	test('all container kinds use "members" uniformly', () => {
		const containers = [
			{ name: 'A', kind: 'class', members: [{ name: 'a', kind: 'variable' }] },
			{ name: 'A', kind: 'interface', members: [{ name: 'a', kind: 'variable' }] },
			{ name: 'A', kind: 'type', members: [{ name: 'a', kind: 'variable' }] },
			{ name: 'A', kind: 'enum', members: [{ name: 'a', kind: 'variable' }] }
		] as const;

		for (const input of containers) {
			const decl = DeclarationJson.parse(input);
			if ('members' in decl) {
				assert.strictEqual(decl.members.length, 1, `${input.kind} should have 1 member`);
				assert.strictEqual(decl.members[0]!.name, 'a');
			} else {
				assert.fail(`${input.kind} should have members field`);
			}
		}
	});
});
