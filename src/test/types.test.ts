import { test, assert } from 'vitest';

import { ComponentPropJson, OverloadJson, TypeJson } from '$lib/types.ts';

// `ComponentPropJson.parameters` is a deliberate exception to the array-field
// `.default([])` policy: absence marks a prop with no structured parameters,
// distinct from a callable with an empty list. These lock in that contract so a
// well-meaning "consistency" change to `.default([])` fails loudly.

test('ComponentPropJson.parameters is optional — absence is meaningful, not an empty list', () => {
	const prop = ComponentPropJson.parse({ name: 'label', type: 'string' });
	assert.equal(prop.parameters, undefined);
});

test('ComponentPropJson.parameters round-trips a populated list', () => {
	const prop = ComponentPropJson.parse({
		name: 'row',
		type: 'Snippet<[item: string]>',
		parameters: [{ name: 'item', type: 'string' }]
	});
	assert.ok(prop.parameters);
	assert.equal(prop.parameters.length, 1);
});

test('array fields under the .default([]) policy still materialize [] (contrast)', () => {
	const overload = OverloadJson.parse({ typeSignature: '() => void' });
	assert.deepEqual(overload.parameters, []);
	assert.deepEqual(overload.genericParams, []);
});

// One node of every `TypeJson` kind — the `Record` keying forces a compile
// error when the TS union gains a kind without a test node, and `.parse` fails
// when the Zod union misses one (`z.ZodType` is covariant in both parameters,
// so the schema annotation alone can't catch a missing runtime variant).
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
		assert.deepStrictEqual(TypeJson.parse(node), node);
	}
});

test('TypeJson tuple elements are strict objects', () => {
	assert.throws(() =>
		TypeJson.parse({
			kind: 'tuple',
			elements: [{ type: { kind: 'intrinsic', text: 'string' }, extra: true }]
		})
	);
});
