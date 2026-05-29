/**
 * Tests for source.ts — pure file type predicates and path helpers.
 *
 * These tests cover:
 * - Module type predicates (isTypescript, isSvelte, isCss, isJson)
 * - Default analyzer detection (getDefaultAnalyzer)
 * - Component name extraction (getComponentName)
 */

import {test, assert, describe} from 'vitest';

import {
	getComponentName,
	isTypescript,
	isSvelte,
	isCss,
	isJson,
	getDefaultAnalyzer,
} from '$lib/source.js';

describe('getComponentName', () => {
	test('extracts component name from simple path', () => {
		assert.strictEqual(getComponentName('Alert.svelte'), 'Alert');
	});

	test('extracts component name from nested path', () => {
		assert.strictEqual(getComponentName('components/Button.svelte'), 'Button');
	});

	test('handles deeply nested paths', () => {
		assert.strictEqual(getComponentName('a/b/c/Widget.svelte'), 'Widget');
	});
});

describe('module type predicates', () => {
	describe('isTypescript', () => {
		test.each([
			// .ts files
			['foo.ts', true],
			['path/to/bar.ts', true],
			// .js files
			['foo.js', true],
			['path/to/bar.js', true],
			// .d.ts declaration files (excluded)
			['types.d.ts', false],
			['path/to/global.d.ts', false],
			['index.d.ts', false],
			// Other extensions
			['foo.svelte', false],
			['foo.css', false],
			['foo.json', false],
			// Case-sensitive — uppercase extensions are not recognized (correct on Linux)
			['foo.TS', false],
			['foo.JS', false],
		])('%s → %s', (path, expected) => {
			assert.strictEqual(isTypescript(path), expected);
		});
	});

	describe('isSvelte', () => {
		test.each([
			// .svelte files
			['Alert.svelte', true],
			['components/Button.svelte', true],
			// Other extensions
			['foo.ts', false],
			['foo.js', false],
		])('%s → %s', (path, expected) => {
			assert.strictEqual(isSvelte(path), expected);
		});
	});

	describe('isCss', () => {
		test.each([
			// .css files
			['styles.css', true],
			['path/to/theme.css', true],
			// Other extensions
			['foo.ts', false],
			['foo.svelte', false],
		])('%s → %s', (path, expected) => {
			assert.strictEqual(isCss(path), expected);
		});
	});

	describe('isJson', () => {
		test.each([
			// .json files
			['data.json', true],
			['path/to/config.json', true],
			// Other extensions
			['foo.ts', false],
			['foo.js', false],
		])('%s → %s', (path, expected) => {
			assert.strictEqual(isJson(path), expected);
		});
	});
});

describe('getDefaultAnalyzer', () => {
	test('returns typescript for .ts files', () => {
		assert.strictEqual(getDefaultAnalyzer('/project/src/lib/foo.ts'), 'typescript');
		assert.strictEqual(getDefaultAnalyzer('bar.ts'), 'typescript');
	});

	test('returns typescript for .js files', () => {
		assert.strictEqual(getDefaultAnalyzer('/project/src/lib/foo.js'), 'typescript');
		assert.strictEqual(getDefaultAnalyzer('utils.js'), 'typescript');
	});

	test('returns svelte for .svelte files', () => {
		assert.strictEqual(getDefaultAnalyzer('/project/src/lib/Button.svelte'), 'svelte');
		assert.strictEqual(getDefaultAnalyzer('Card.svelte'), 'svelte');
	});

	test('returns null for .d.ts declaration files', () => {
		assert.isNull(getDefaultAnalyzer('/project/src/lib/types.d.ts'));
		assert.isNull(getDefaultAnalyzer('global.d.ts'));
		assert.isNull(getDefaultAnalyzer('path/to/index.d.ts'));
	});

	test('returns css for .css files', () => {
		assert.strictEqual(getDefaultAnalyzer('/project/src/lib/styles.css'), 'css');
		assert.strictEqual(getDefaultAnalyzer('theme.css'), 'css');
	});

	test('returns json for .json files', () => {
		assert.strictEqual(getDefaultAnalyzer('/project/src/lib/data.json'), 'json');
		assert.strictEqual(getDefaultAnalyzer('config.json'), 'json');
	});

	test('returns null for unsupported extensions', () => {
		assert.isNull(getDefaultAnalyzer('readme.md'));
	});
});
