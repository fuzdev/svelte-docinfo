/**
 * Tests for merged value+type symbol extraction.
 *
 * `export const Foo = ...` + `export type Foo = ...` (the ecosystem's
 * schema/type pattern) share one `ts.Symbol` with combined flags. Kind-aware
 * node selection (`selectDeclarationNode`) documents the type meaning — the
 * type alias's structure with members — instead of the value's type under the
 * type's kind. Covers: merged const+type, merged const+interface, declaration
 * order independence, JSDoc selected-node-first with fallback to the const's
 * docs, `@nodocs` on either declaration suppressing, `sourceLine` on the
 * selected node, and un-merged controls staying unchanged.
 *
 * Zod is simulated dependency-free with a local `Schema` interface and a
 * conditional `Infer` so the alias is alias-lost like `z.infer<typeof Foo>`.
 * Fixture lock-ins: `ts/declarations/type/merged-value-type` and
 * `ts/declarations/interface/merged-value-interface`.
 */

import { test, assert, describe } from 'vitest';

import type { ModuleJson } from '$lib/types.ts';

import { analyzeTestProject } from './test-module-helpers.ts';

/** Zod-free simulation of the schema/type pattern's shape. */
const SCHEMA_PRELUDE = `
interface Schema<O> {
	readonly _output: O;
}
type Infer<S extends Schema<unknown>> = S extends Schema<infer O> ? O : never;
const create = <O>(): Schema<O> => ({}) as Schema<O>;
`;

/** Analyze a single-file project and return its module. */
const analyzeFile = async (content: string): Promise<ModuleJson> => {
	const { modules } = await analyzeTestProject({ 'src/lib/a.ts': content });
	assert.ok(modules[0], 'expected a module');
	return modules[0];
};

describe('merged value+type symbols', () => {
	test('merged const+type documents the type alias structure with members', async () => {
		const module = await analyzeFile(`${SCHEMA_PRELUDE}
export const Foo: Schema<{ a: string; b: number }> = create();
export type Foo = Infer<typeof Foo>;
`);
		assert.strictEqual(module.declarations.length, 1);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'type', 'expected a type declaration');
		assert.strictEqual(declaration.name, 'Foo');
		assert.strictEqual(declaration.typeSignature, '{ a: string; b: number; }');
		assert.strictEqual(declaration.mergedValue, true);
		assert.deepStrictEqual(
			module.declarations[0]?.kind === 'type'
				? declaration.members.map((m) => [m.name, m.typeSignature])
				: [],
			[
				['a', 'string'],
				['b', 'number']
			]
		);
	});

	test('merged pair matches the un-merged control', async () => {
		const module = await analyzeFile(`${SCHEMA_PRELUDE}
export const Foo: Schema<{ a: string; b: number }> = create();
export type Foo = Infer<typeof Foo>;
export type Standalone = Infer<typeof Foo>;
`);
		const merged = module.declarations.find((d) => d.name === 'Foo');
		const control = module.declarations.find((d) => d.name === 'Standalone');
		assert(merged?.kind === 'type', 'expected a type declaration');
		assert(control?.kind === 'type', 'expected a type declaration');
		assert.strictEqual(merged.typeSignature, control.typeSignature);
		assert.deepStrictEqual(merged.members, control.members);
		assert.strictEqual(merged.mergedValue, true);
		assert.strictEqual(control.mergedValue, false);
	});

	test('declaration order does not affect selection', async () => {
		const module = await analyzeFile(`${SCHEMA_PRELUDE}
export type Foo = Infer<typeof Foo>;
export const Foo: Schema<{ a: string }> = create();
`);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'type', 'expected a type declaration');
		assert.strictEqual(declaration.typeSignature, '{ a: string; }');
	});

	test('merged const+interface documents the interface with members', async () => {
		const module = await analyzeFile(`
export interface Bar {
	a: string;
	b: number;
}
export const Bar = { a: 'x', b: 1 };
`);
		assert.strictEqual(module.declarations.length, 1);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'interface', 'expected an interface declaration');
		assert.strictEqual(declaration.name, 'Bar');
		assert.strictEqual(declaration.mergedValue, true);
		assert.deepStrictEqual(
			declaration.members.map((m) => [m.name, m.typeSignature]),
			[
				['a', 'string'],
				['b', 'number']
			]
		);
	});

	test('sourceLine points at the selected type-space node', async () => {
		const module = await analyzeFile(`export const Foo = 1;
export type Foo = number;
`);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'type', 'expected a type declaration');
		assert.strictEqual(declaration.sourceLine, 2);
	});

	describe('JSDoc', () => {
		test('docs on the selected type declaration win', async () => {
			const module = await analyzeFile(`
/** Const docs. */
export const Foo = 1;
/** Type docs. */
export type Foo = number;
`);
			assert.strictEqual(module.declarations[0]?.docComment, 'Type docs.');
		});

		test('docs fall back to the merged const when the type has none', async () => {
			const module = await analyzeFile(`
/** Const docs. */
export const Foo = 1;
export type Foo = number;
`);
			assert.strictEqual(module.declarations[0]?.docComment, 'Const docs.');
		});

		test('tag-only doc content on the const falls through too', async () => {
			const module = await analyzeFile(`
/** @deprecated use Bar instead */
export const Foo = 1;
export type Foo = number;
`);
			assert.strictEqual(module.declarations[0]?.deprecatedMessage, 'use Bar instead');
		});
	});

	describe('@nodocs', () => {
		test('@nodocs on the const suppresses the merged declaration', async () => {
			const module = await analyzeFile(`
/** @nodocs */
export const Foo = 1;
export type Foo = number;
export const kept = 2;
`);
			assert.deepStrictEqual(
				module.declarations.map((d) => d.name),
				['kept']
			);
		});

		test('@nodocs on the type suppresses the merged declaration', async () => {
			const module = await analyzeFile(`
export const Foo = 1;
/** @nodocs */
export type Foo = number;
export const kept = 2;
`);
			assert.deepStrictEqual(
				module.declarations.map((d) => d.name),
				['kept']
			);
		});
	});

	test('un-merged const keeps value extraction', async () => {
		const module = await analyzeFile(`${SCHEMA_PRELUDE}
export const solo: Schema<{ a: string }> = create();
`);
		const declaration = module.declarations[0];
		assert(declaration?.kind === 'variable', 'expected a variable declaration');
		assert.strictEqual(declaration.typeSignature, 'Schema<{ a: string; }>');
	});
});
