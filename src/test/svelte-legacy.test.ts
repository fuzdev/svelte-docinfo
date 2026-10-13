/**
 * Unit tests for the legacy-export scan (`scanLegacyExports`): which of an
 * instance script's exports are props, which are accessors, and what each
 * prop's default is.
 *
 * The scan through the pipeline is in `analyze.legacy-components.test.ts`,
 * and the props anchor's refusals in `analyze.legacy-refusal.test.ts`.
 */

import { test, assert, describe } from 'vitest';
import ts from 'typescript';

import { scanLegacyExports } from '#lib/svelte-legacy.ts';

/** Parse instance-script content the way `analyzeSvelteModule` does. */
const scan = (script: string) =>
	scanLegacyExports(
		ts.createSourceFile('script.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
	);

describe('scanLegacyExports', () => {
	test('reads props in export order with their defaults', () => {
		const { props, accessors } = scan(`
			export let a: string;
			export let b = 1;
			export let c = undefined;
			export var d = { a: 1 };
		`);
		assert.deepStrictEqual(
			props.map(({ name, hasInitializer, defaultValue }) => ({
				name,
				hasInitializer,
				defaultValue
			})),
			[
				{ name: 'a', hasInitializer: false, defaultValue: undefined },
				{ name: 'b', hasInitializer: true, defaultValue: '1' },
				// an explicit `undefined` is an initializer, but not a default
				{ name: 'c', hasInitializer: true, defaultValue: undefined },
				{ name: 'd', hasInitializer: true, defaultValue: '{ a: 1 }' }
			]
		);
		assert.strictEqual(accessors.size, 0);
	});

	test('an export clause names the prop and carries the binding default', () => {
		const { props } = scan(`
			export { a as class, b };
			let a = 'value';
			let b: number;
		`);
		assert.deepStrictEqual(
			props.map(({ name, defaultValue }) => ({ name, defaultValue })),
			[
				{ name: 'class', defaultValue: "'value'" },
				{ name: 'b', defaultValue: undefined }
			]
		);
	});

	test('const, function, and class exports are accessors; type-only exports are neither', () => {
		const { props, accessors } = scan(`
			type T = number;
			interface I {}
			export const a = 1;
			export function fn() {}
			export class C {}
			const b = 2;
			function fn2() {}
			export { b, fn2 as fn3, I };
			export type { T };
		`);
		assert.deepStrictEqual(props, []);
		assert.deepStrictEqual([...accessors].sort(), ['C', 'a', 'b', 'fn', 'fn3']);
	});

	test('a destructured declaration is skipped, and its neighbors are still read', () => {
		const { props } = scan(`let { x } = o, a = 1;\nexport { a };\nexport let [y] = o, b = 2;`);
		assert.deepStrictEqual(
			props.map((p) => p.name),
			['a', 'b']
		);
	});

	test('a using binding exported through a clause is an accessor', () => {
		const { props, accessors } = scan(`using a = o;\nexport { a };`);
		assert.deepStrictEqual(props, []);
		assert.deepStrictEqual([...accessors], ['a']);
	});

	test('a re-export from another module names no prop, even over a local of the same name', () => {
		const { props, accessors } = scan(`let a = 1;\nexport { a } from './a.ts';`);
		assert.deepStrictEqual(props, []);
		assert.deepStrictEqual([...accessors], []);
	});

	test('a type-only specifier names no prop, even over a mutable binding of the same name', () => {
		const { props } = scan(`let A = 1;\ntype A = number;\nexport { type A };`);
		assert.deepStrictEqual(props, []);
	});
});
