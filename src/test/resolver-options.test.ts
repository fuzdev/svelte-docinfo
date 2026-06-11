import {test, assert} from 'vitest';

import {
	normalizeResolveImport,
	noDepsResolver,
	type ImportResolver,
	type ResolveImportFn,
} from '$lib/dep-resolver.js';
import {analyzeFromFiles} from '$lib/analyze.js';

const ROOT = '/proj';

// A bare resolver that maps the `./b.js` specifier to the `b.ts` source id.
const resolveBare: ResolveImportFn = (specifier) =>
	specifier === './b.js' ? '/proj/src/lib/b.ts' : null;

// normalizeResolveImport: the ResolveImport union → ImportResolver coercion

test('normalizeResolveImport wraps a bare function with a synthesized identity', () => {
	const resolver = normalizeResolveImport(resolveBare);
	assert.ok(resolver);
	assert.equal(resolver.resolve, resolveBare);
	assert.ok(resolver.identity, 'a fresh identity is synthesized for bare functions');
});

test('normalizeResolveImport gives bare functions a fresh identity per call', () => {
	const x = normalizeResolveImport(resolveBare);
	const y = normalizeResolveImport(resolveBare);
	assert.ok(x);
	assert.ok(y);
	assert.notEqual(x.identity, y.identity);
});

test('normalizeResolveImport passes a token-paired resolver through unchanged', () => {
	const resolver: ImportResolver = {resolve: () => null, identity: 'stable'};
	assert.equal(normalizeResolveImport(resolver), resolver);
});

test('normalizeResolveImport returns undefined for undefined', () => {
	assert.equal(normalizeResolveImport(undefined), undefined);
});

test('normalizeResolveImport leaves the shared no-deps resolver intact', () => {
	assert.equal(normalizeResolveImport(noDepsResolver), noDepsResolver);
});

// analyzeFromFiles: contradictory resolveImport + resolveDependencies: false

test('analyzeFromFiles throws when resolveImport is combined with resolveDependencies: false', async () => {
	let threw = false;
	try {
		await analyzeFromFiles({
			projectRoot: ROOT,
			resolveDependencies: false,
			resolveImport: resolveBare,
		});
	} catch (err) {
		threw = true;
		assert.match((err as Error).message, /resolveImport/);
		assert.match((err as Error).message, /resolveDependencies/);
	}
	assert.ok(threw, 'expected a contradictory-options error before any file I/O');
});

test('analyzeFromFiles does not trip the guard for resolveDependencies: false alone', async () => {
	// Disabling resolution without a custom resolver is valid; reaching discovery
	// on an empty/nonexistent root must not surface the options error.
	let optionsError = false;
	try {
		await analyzeFromFiles({projectRoot: ROOT, resolveDependencies: false});
	} catch (err) {
		if ((err as Error).message.includes('resolveImport')) optionsError = true;
	}
	assert.notOk(optionsError, 'resolveDependencies: false alone must not trip the guard');
});
