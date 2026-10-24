import { describe, test, assert } from 'vitest';

import { lexImports } from '#lib/dep-resolver.ts';

describe('lexImports', () => {
	test('collects static imports and re-exports in source order', () => {
		const content = [
			"import a from './a.ts';",
			"import {b} from './b.ts';",
			"import './side-effect.ts';",
			"export * from './star.ts';",
			"export {c as d} from './renamed.ts';"
		].join('\n');
		assert.deepEqual(lexImports(content), [
			'./a.ts',
			'./b.ts',
			'./side-effect.ts',
			'./star.ts',
			'./renamed.ts'
		]);
	});

	test('keeps type-only imports and re-exports', () => {
		const content = [
			"import type {A} from './a.ts';",
			"import {type B} from './b.ts';",
			"export type {C} from './c.ts';",
			"export type * from './d.ts';"
		].join('\n');
		assert.deepEqual(lexImports(content), ['./a.ts', './b.ts', './c.ts', './d.ts']);
	});

	test('keeps namespace re-exports', () => {
		const content = [
			"export * as ns from './a.ts';",
			"export type * as types from './b.ts';",
			"export * as default from './c.ts';"
		].join('\n');
		assert.deepEqual(lexImports(content), ['./a.ts', './b.ts', './c.ts']);
	});

	test('keeps import-equals, module augmentations, and import types', () => {
		const content = [
			"import a = require('./a.ts');",
			"declare module './b.ts' { interface B { b: 1 } }",
			"export type C = typeof import('./c.ts');"
		].join('\n');
		assert.deepEqual(lexImports(content), ['./a.ts', './b.ts', './c.ts']);
	});

	test('orders dynamic imports among static ones by position', () => {
		const content = [
			"import {a} from './a.ts';",
			"const b = () => import('./b.ts');",
			"export {c} from './c.ts';"
		].join('\n');
		assert.deepEqual(lexImports(content), ['./a.ts', './b.ts', './c.ts']);
	});

	test('keeps literal dynamic imports, omits non-literal ones and require calls', () => {
		const content = [
			"const a = await import('./a.ts');",
			'const b = await import(name);',
			"const c = require('./c.js');"
		].join('\n');
		assert.deepEqual(lexImports(content), ['./a.ts']);
	});

	test('ignores specifiers in comments and strings', () => {
		const content = [
			"// import './comment.ts';",
			'const s = "import \'./string.ts\'";',
			"import {a} from './a.ts';"
		].join('\n');
		assert.deepEqual(lexImports(content), ['./a.ts']);
	});

	// TypeScript syntax that a JS lexer misreads as a regex or comparison
	test('scans past a non-null assertion followed by division', () => {
		const content = [
			"import {a} from './a.ts';",
			'const x = c[i]! / (z + i);',
			"import {b} from './b.ts';"
		].join('\n');
		assert.deepEqual(lexImports(content), ['./a.ts', './b.ts']);
	});

	test('scans past nested generics closing before an arrow', () => {
		const content = [
			"import {a} from './a.ts';",
			'export const fn = async (): Promise<Result<{a: number}, {b: string}>> => {',
			'\treturn null as any;',
			'};',
			"import {b} from './b.ts';"
		].join('\n');
		assert.deepEqual(lexImports(content), ['./a.ts', './b.ts']);
	});

	test('parses .tsx and .jsx paths as TSX, keeping imports inside JSX markup', () => {
		const content = [
			"import a from './a.ts';",
			"export const C = () => <p>{a} / {import('./b.ts')}</p>;",
			"import('./c.ts');"
		].join('\n');
		for (const path of ['/p/src/lib/c.tsx', '/p/src/lib/c.jsx']) {
			assert.deepEqual(lexImports(content, path), ['./a.ts', './b.ts', './c.ts']);
		}
	});

	test('parses other paths as TS, where a generic arrow and an assertion read as such', () => {
		const content = [
			"import a from './a.ts';",
			"export const f = <T>(x: T): T => (<T>import('./b.ts'), x);"
		].join('\n');
		for (const path of [undefined, '/p/src/lib/c.ts', '/p/src/lib/c.mts', '/p/src/lib/c.js']) {
			assert.deepEqual(lexImports(content, path), ['./a.ts', './b.ts']);
		}
	});
});
