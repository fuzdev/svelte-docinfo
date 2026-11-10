import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { globSync } from 'tinyglobby';
import { test, assert, describe } from 'vitest';
import * as s from '@fuzdev/fuz_schema/schema.ts';

import {
	ComponentPropJson,
	OverloadJson,
	ParameterJson,
	TypeJson,
	parseModuleJson
} from '#lib/types.ts';
import { AnalyzeResultJson, parseAnalyzeResult } from '#lib/analyze-core.ts';
import { parseDiagnostics } from '#lib/diagnostics.ts';

// `ComponentPropJson.parameters` is a deliberate exception to the array-field
// `[]` default policy: absence marks a prop with no structured parameters,
// distinct from a callable with an empty list. These lock in that contract so a
// well-meaning "consistency" change to a `[]` default fails loudly.

test('ComponentPropJson.parameters is optional — absence is meaningful, not an empty list', () => {
	const prop = s.parse_or_throw(ComponentPropJson, { name: 'label', type: 'string' });
	assert.equal(prop.parameters, undefined);
});

test('ComponentPropJson.parameters round-trips a populated list', () => {
	const prop = s.parse_or_throw(ComponentPropJson, {
		name: 'row',
		type: 'Snippet<[item: string]>',
		parameters: [{ name: 'item', type: 'string' }]
	});
	assert.ok(prop.parameters);
	assert.equal(prop.parameters.length, 1);
});

test('array fields under the [] default policy still materialize [] (contrast)', () => {
	const overload = s.parse_or_throw(OverloadJson, { typeSignature: '() => void' });
	assert.deepEqual(overload.parameters, []);
	assert.deepEqual(overload.genericParams, []);
});

// One node of every `TypeJson` kind — the `Record` keying forces a compile
// error when the TS union gains a kind without a test node, and parsing fails
// when the schema's variant misses one (`s.Schema` is covariant in its
// output, so the schema annotation alone can't catch a missing runtime variant).
test('TypeJson parses one node of every kind and round-trips it', () => {
	const nodes: Record<TypeJson['kind'], TypeJson> = {
		intrinsic: { kind: 'intrinsic', text: 'string' },
		literal: { kind: 'literal', value: false, text: 'false' },
		reference: {
			kind: 'reference',
			name: 'Map',
			typeArgs: [{ kind: 'intrinsic', text: 'string' }]
		},
		array: { kind: 'array', element: { kind: 'intrinsic', text: 'string' }, readonly: true },
		tuple: {
			kind: 'tuple',
			elements: [
				{ name: 'a', type: { kind: 'intrinsic', text: 'string' }, optional: true, rest: true }
			],
			readonly: true
		},
		union: {
			kind: 'union',
			alias: 'A',
			members: [
				{ kind: 'literal', value: 'a', text: '"a"' },
				{ kind: 'intrinsic', text: 'null' }
			]
		},
		intersection: {
			kind: 'intersection',
			members: [
				{ kind: 'reference', name: 'B' },
				{ kind: 'object', text: '{ c: string; }' }
			]
		},
		function: { kind: 'function', text: '() => void' },
		object: { kind: 'object', text: '{ a: string; }' },
		other: { kind: 'other', text: 'T' }
	};
	for (const node of Object.values(nodes)) {
		assert.deepStrictEqual(s.parse_or_throw(TypeJson, node), node);
	}
});

test('TypeJson tuple elements are strict objects', () => {
	assert.throws(() =>
		s.parse_or_throw(TypeJson, {
			kind: 'tuple',
			elements: [{ type: { kind: 'intrinsic', text: 'string' }, extra: true }]
		})
	);
});

test('array defaults are fresh per parse, never one shared array', () => {
	const a = s.parse_or_throw(OverloadJson, { typeSignature: '() => void' });
	const b = s.parse_or_throw(OverloadJson, { typeSignature: '() => void' });
	assert.notStrictEqual(a.parameters, b.parameters);
	a.parameters.push({ name: 'x', type: 'string', optional: false, rest: false });
	assert.deepEqual(b.parameters, []);
});

// `propertyDescriptions` and `mutates` hold author-written keys, which may
// collide with `Object.prototype` names
describe('string records', () => {
	test('string records keep `constructor` and `prototype` keys and drop `__proto__`', () => {
		const input: unknown = JSON.parse(
			'{"name":"o","type":"T","propertyDescriptions":{"constructor":"a","prototype":"b","x":"c","__proto__":"d"}}'
		);
		const parsed = s.parse_or_throw(ParameterJson, input);
		assert.deepStrictEqual(Object.entries(parsed.propertyDescriptions!), [
			['constructor', 'a'],
			['prototype', 'b'],
			['x', 'c']
		]);
		assert.strictEqual(Object.getPrototypeOf(parsed.propertyDescriptions), Object.prototype);
	});

	test('string records check an own `__proto__` key before dropping it', () => {
		const input: unknown = JSON.parse(
			'{"name":"o","type":"T","propertyDescriptions":{"__proto__":{"x":"y"},"a":"y"}}'
		);
		assert.throws(() => s.parse_or_throw(ParameterJson, input), /__proto__/);
	});

	test('string records reject non-string values and arrays', () => {
		for (const propertyDescriptions of [{ a: 1 }, ['a'], null]) {
			assert.throws(() =>
				s.parse_or_throw(ParameterJson, { name: 'o', type: 'T', propertyDescriptions })
			);
		}
	});

	test('each non-string value gets its own issue, pathed to its key', () => {
		const result = s.parse(ParameterJson, {
			name: 'o',
			type: 'T',
			propertyDescriptions: { a: 1, ok: 'x', b: null, c: ['y'], d: {} }
		});
		assert(!result.ok);
		assert.deepStrictEqual(result.issues.map(s.format_issue), [
			'propertyDescriptions.a: expected string, received number',
			'propertyDescriptions.b: expected string, received null',
			'propertyDescriptions.c: expected string, received array',
			'propertyDescriptions.d: expected string, received object'
		]);
	});

	test('a non-object string record is one issue at the record itself', () => {
		const result = s.parse(ParameterJson, {
			name: 'o',
			type: 'T',
			propertyDescriptions: [1]
		});
		assert(!result.ok);
		assert.deepStrictEqual(result.issues.map(s.format_issue), [
			'propertyDescriptions: expected object, received array'
		]);
	});
});

describe('parse helpers', () => {
	const catchError = (fn: () => unknown): Error => {
		try {
			fn();
		} catch (error) {
			assert(error instanceof Error);
			return error;
		}
		assert.fail('expected a throw');
	};

	test('the message lists every issue as `path: message`, one per line', () => {
		const error = catchError(() =>
			parseAnalyzeResult({
				modules: [
					{ path: 'a.ts', declarations: [{ name: 'f', kind: 'function', typeInfo: {} }] },
					{ path: 1 }
				]
			})
		);
		assert(error instanceof s.SchemaError);
		assert.strictEqual(error.issues.length, 2);
		assert.strictEqual(error.message, error.issues.map(s.format_issue).join('\n'));
		const lines = error.message.split('\n');
		assert.strictEqual(lines.length, 2);
		assert.match(lines[0]!, /^modules\.0\.declarations\.0\.typeInfo: expected no unknown keys, /);
		assert.strictEqual(lines[1], 'modules.1.path: expected string, received number');
	});

	test('the message lists past the ten issues `s.SchemaError` stops at', () => {
		const error = catchError(() =>
			parseModuleJson({ path: 'a.ts', dependencies: Array.from({ length: 12 }, (_, i) => i) })
		);
		assert(error instanceof s.SchemaError);
		assert.strictEqual(error.message.split('\n').length, 12);
	});

	test('a message of a hundred issues says there may be more', () => {
		const withBad = (count: number): unknown => ({
			path: 'a.ts',
			dependencies: Array.from({ length: count }, (_, i) => i)
		});
		// fuz_schema builds at most a hundred issues and its result doesn't say more failed
		for (const count of [100, 250]) {
			const error = catchError(() => parseModuleJson(withBad(count)));
			assert(error instanceof s.SchemaError);
			assert.strictEqual(error.issues.length, 100);
			const lines = error.message.split('\n');
			assert.strictEqual(lines.length, 101);
			assert.strictEqual(lines[99], 'dependencies.99: expected string, received number');
			assert.strictEqual(lines[100], '(only the first 100 issues are reported, there may be more)');
		}
		const under = catchError(() => parseModuleJson(withBad(99)));
		assert.strictEqual(under.message.split('\n').length, 99);
		assert.notMatch(under.message, /there may be more/);
	});

	test('an issue at the root has no path prefix', () => {
		assert.strictEqual(
			catchError(() => parseModuleJson(null)).message,
			'expected object, received null'
		);
	});

	test('an object with several unknown keys reports each', () => {
		assert.strictEqual(
			catchError(() => parseModuleJson({ path: 'a.ts', x: 1, y: 2 })).message,
			'x: expected no unknown keys, received number\ny: expected no unknown keys, received number'
		);
	});

	test('a bad string-record value is reported at its key', () => {
		assert.strictEqual(
			catchError(() =>
				parseModuleJson({
					path: 'a.ts',
					declarations: [{ name: 'f', kind: 'function', mutates: { a: 1 } }]
				})
			).message,
			'declarations.0.mutates.a: expected string, received number'
		);
	});

	test('an array is not an analysis result, even an empty one', () => {
		const message = 'expected object, received array';
		for (const value of [[], [{ path: 'a.ts' }]]) {
			assert.strictEqual(catchError(() => parseAnalyzeResult(value)).message, message);
			// the guard is the schema's, not the helper's
			assert.throws(() => s.parse_or_throw(AnalyzeResultJson, value), message);
		}
		assert.deepStrictEqual(parseAnalyzeResult({}), { modules: [], diagnostics: [] });
		assert.deepStrictEqual(
			{ ...s.parse_or_throw(AnalyzeResultJson, Object.create(null)) },
			{ modules: [], diagnostics: [] }
		);
	});

	test('parseModuleJson and parseDiagnostics root their paths at their own value', () => {
		assert.match(catchError(() => parseModuleJson({ path: 'a.ts', x: 1 })).message, /^x: /);
		assert.match(catchError(() => parseDiagnostics([{ kind: 'nope' }])).message, /^0\.kind: /);
	});
});

test('numeric fields reject ±Infinity', () => {
	const cases: Array<(n: number) => unknown> = [
		(n) => ({ path: 'a.ts', declarations: [{ name: 'a', kind: 'type', sourceLine: n }] }),
		(n) => ({ path: 'a.ts', reExports: [{ name: 'a', module: 'b.ts', sourceLine: n }] }),
		(n) => ({ path: 'a.ts', externalReExports: [{ name: 'a', specifier: 'pkg', sourceLine: n }] }),
		(n) => ({
			path: 'a.ts',
			declarations: [
				{ name: 'a', kind: 'type', typeInfo: { kind: 'literal', value: n, text: String(n) } }
			]
		})
	];
	for (const make of cases) {
		parseModuleJson(make(3));
		for (const n of [Infinity, -Infinity]) {
			assert.throws(() => parseModuleJson(make(n)), /received -?Infinity/);
		}
	}
});

// `zod` isn't a dependency of this package and doesn't resolve here; this guards
// against reintroducing an import that would break for consumers
test('nothing under src imports zod', () => {
	const srcDir = new URL('../', import.meta.url);
	const files = globSync('**/*.{ts,js,svelte}', { cwd: fileURLToPath(srcDir) });
	assert.ok(
		files.some((file) => file.startsWith('lib/')),
		'expected src/lib files (glob broke?)'
	);
	assert.ok(
		files.some((file) => file.startsWith('test/fixtures/')),
		'expected fixture files (glob broke?)'
	);
	const offenders = files.filter((file) =>
		/\bfrom\s*['"]zod(?:\/[^'"]*)?['"]|\bimport\s*\(\s*['"]zod(?:\/[^'"]*)?['"]\s*\)|\bimport\s*['"]zod(?:\/[^'"]*)?['"]/.test(
			readFileSync(new URL(file, srcDir), 'utf-8')
		)
	);
	assert.deepStrictEqual(offenders, []);
});
