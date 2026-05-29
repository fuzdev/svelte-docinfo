import {test, assert} from 'vitest';

import {ComponentPropJson, OverloadJson} from '$lib/types.js';

// `ComponentPropJson.parameters` is a deliberate exception to the array-field
// `.default([])` policy: absence marks a prop with no structured parameters,
// distinct from a callable with an empty list. These lock in that contract so a
// well-meaning "consistency" change to `.default([])` fails loudly.

test('ComponentPropJson.parameters is optional — absence is meaningful, not an empty list', () => {
	const prop = ComponentPropJson.parse({name: 'label', type: 'string'});
	assert.equal(prop.parameters, undefined);
});

test('ComponentPropJson.parameters round-trips a populated list', () => {
	const prop = ComponentPropJson.parse({
		name: 'row',
		type: 'Snippet<[item: string]>',
		parameters: [{name: 'item', type: 'string'}],
	});
	assert.ok(prop.parameters);
	assert.equal(prop.parameters.length, 1);
});

test('array fields under the .default([]) policy still materialize [] (contrast)', () => {
	const overload = OverloadJson.parse({typeSignature: '() => void'});
	assert.deepEqual(overload.parameters, []);
	assert.deepEqual(overload.genericParams, []);
});
