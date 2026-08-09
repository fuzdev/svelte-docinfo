/**
 * Tests for member extraction shapes across the container kinds: literal
 * property names (unquoted, matching the symbol-based paths), `readonly`
 * index signatures, `genericParams` on callable properties, `@default` →
 * `defaultValue` on members of every kind (callable members included;
 * top-level function declarations excluded), and graceful degradation when a
 * member's type is unresolvable (replacing the old `errors/*` fixture
 * category, which ran no extractor and asserted nothing).
 */

import { test, assert, describe } from 'vitest';

import type { ModuleJson } from '$lib/types.ts';
import type { AnalyzeResultJson } from '$lib/analyze-core.ts';

import { analyzeTestProject } from './test-module-helpers.ts';

/** Analyze a single-file project and return the result envelope. */
const analyzeSource = (content: string): Promise<AnalyzeResultJson> =>
	analyzeTestProject({ 'src/lib/a.ts': content });

/** Analyze a single-file project and return its module. */
const analyzeFile = async (content: string): Promise<ModuleJson> => {
	const { modules } = await analyzeSource(content);
	assert.ok(modules[0], 'expected a module');
	return modules[0];
};

describe('literal member names', () => {
	test('string- and numeric-literal names document unquoted on every container kind', async () => {
		const module = await analyzeFile(`export interface I {
	'data-foo': string;
	42: boolean;
	'do-thing'(): void;
}
export type T = {
	'data-foo': string;
	42: boolean;
};
export class C {
	'data-foo' = 1;
}`);
		const iface = module.declarations.find((d) => d.name === 'I');
		assert(iface?.kind === 'interface', 'expected an interface declaration');
		assert.deepStrictEqual(
			iface.members.map((m) => m.name),
			['data-foo', '42', 'do-thing']
		);
		const alias = module.declarations.find((d) => d.name === 'T');
		assert(alias?.kind === 'type', 'expected a type declaration');
		assert.deepStrictEqual(
			alias.members.map((m) => m.name),
			['data-foo', '42']
		);
		const cls = module.declarations.find((d) => d.name === 'C');
		assert(cls?.kind === 'class', 'expected a class declaration');
		assert.deepStrictEqual(
			cls.members.map((m) => m.name),
			['data-foo']
		);
	});
});

describe('readonly index signatures', () => {
	test('the readonly modifier survives on both container kinds', async () => {
		const module = await analyzeFile(`export interface I {
	readonly [key: string]: number;
}
export type T = {
	readonly [key: string]: number;
};`);
		for (const name of ['I', 'T']) {
			const declaration = module.declarations.find((d) => d.name === name);
			assert(
				declaration?.kind === 'interface' || declaration?.kind === 'type',
				`expected a container declaration for ${name}`
			);
			const index = declaration.members.find((m) => m.name === '[key: string]');
			assert.ok(index, `expected an index-signature member on ${name}`);
			assert.deepStrictEqual(index.modifiers, ['readonly'], `readonly lost on ${name}`);
		}
	});
});

describe('callable property members', () => {
	test('generic callable properties carry genericParams like method signatures', async () => {
		const module = await analyzeFile(`export interface I {
	fromProperty: <X>(x: X) => X;
	fromMethod<X>(x: X): X;
}
export type T = {
	fromProperty: <X>(x: X) => X;
};`);
		const iface = module.declarations.find((d) => d.name === 'I');
		assert(iface?.kind === 'interface', 'expected an interface declaration');
		const alias = module.declarations.find((d) => d.name === 'T');
		assert(alias?.kind === 'type', 'expected a type declaration');
		for (const member of [
			iface.members.find((m) => m.name === 'fromProperty'),
			iface.members.find((m) => m.name === 'fromMethod'),
			alias.members.find((m) => m.name === 'fromProperty')
		]) {
			assert(member?.kind === 'function', 'expected a function member');
			assert.deepStrictEqual(member.genericParams, [{ name: 'X' }]);
		}
	});

	test('`@default` on callable members populates defaultValue on both container kinds', async () => {
		// function members carry `defaultValue` like variable members — for a
		// callable option it documents the behavior used when the callback is
		// omitted; property syntax and method shorthand behave identically
		const { modules, diagnostics } = await analyzeSource(`export interface I {
	/**
	 * A callable option.
	 *
	 * @default noop
	 */
	fn: () => void;
	/**
	 * A method-shorthand option.
	 *
	 * @default identity
	 */
	m(x: number): number;
	/**
	 * A plain option.
	 *
	 * @default 3
	 */
	limit: number;
}
export type T = {
	/** @default noop */
	fn: () => void;
};`);
		const iface = modules[0]?.declarations.find((d) => d.name === 'I');
		assert(iface?.kind === 'interface', 'expected an interface declaration');
		const fn = iface.members.find((m) => m.name === 'fn');
		assert(fn?.kind === 'function', 'expected a function member');
		assert.strictEqual(fn.docComment, 'A callable option.');
		assert.strictEqual(fn.defaultValue, 'noop');
		const shorthand = iface.members.find((m) => m.name === 'm');
		assert(shorthand?.kind === 'function', 'expected a function member for the method shorthand');
		assert.strictEqual(shorthand.defaultValue, 'identity');
		const limit = iface.members.find((m) => m.name === 'limit');
		assert(limit?.kind === 'variable', 'expected a variable member');
		assert.strictEqual(limit.defaultValue, '3');
		const alias = modules[0]?.declarations.find((d) => d.name === 'T');
		assert(alias?.kind === 'type', 'expected a type declaration');
		const aliasFn = alias.members.find((m) => m.name === 'fn');
		assert(aliasFn?.kind === 'function', 'expected a function member on the type alias');
		assert.strictEqual(aliasFn.defaultValue, 'noop');
		assert.strictEqual(diagnostics.length, 0, 'the tag is honored, not misplaced');
	});

	test('`@default` documents class methods but never top-level functions', async () => {
		// members only: `FunctionDeclarationJson` has no `defaultValue` (a
		// top-level function has an implementation — nothing is "defaulted"),
		// and `z.strictObject` would reject a leak at `ModuleJson.parse`
		const module = await analyzeFile(`export class C {
	/** @default noop */
	fn(): void {}
}

/**
 * Docs.
 *
 * @default nonsense
 */
export const arrowFn = (): void => {};

/**
 * Docs.
 *
 * @default nonsense
 */
export function declaredFn(): void {}`);
		const cls = module.declarations.find((d) => d.name === 'C');
		assert(cls?.kind === 'class', 'expected a class declaration');
		const method = cls.members.find((m) => m.name === 'fn');
		assert(method?.kind === 'function', 'expected a function member');
		assert.strictEqual(method.defaultValue, 'noop');
		for (const name of ['arrowFn', 'declaredFn']) {
			const declaration = module.declarations.find((d) => d.name === name);
			assert(declaration?.kind === 'function', `expected a function declaration for ${name}`);
			assert.ok(
				!('defaultValue' in declaration),
				`expected no defaultValue on top-level function ${name}`
			);
		}
	});
});

describe('unresolvable member types', () => {
	test('members degrade to the written reference name, without partial or crash', async () => {
		// the checker prints an unresolved type by its written reference — the
		// member set stays complete and nothing flips partial
		const { modules, diagnostics } = await analyzeSource(`// @ts-nocheck
import type { B } from './nonexistent_module.js';

/** Description. */
export interface A {
	a: B;
	b: string;
}

export class C {
	a: B = undefined;
	fn(x: B): B {
		return x;
	}
}`);
		const module = modules[0];
		const iface = module?.declarations.find((d) => d.name === 'A');
		assert(iface?.kind === 'interface', 'expected an interface declaration');
		assert.strictEqual(iface.docComment, 'Description.');
		assert.deepStrictEqual(
			iface.members.map((m) => ({ name: m.name, type: m.typeSignature, partial: m.partial })),
			[
				{ name: 'a', type: 'B', partial: false },
				{ name: 'b', type: 'string', partial: false }
			]
		);
		const cls = module?.declarations.find((d) => d.name === 'C');
		assert(cls?.kind === 'class', 'expected a class declaration');
		const field = cls.members.find((m) => m.name === 'a');
		assert.strictEqual(field?.typeSignature, 'B');
		const method = cls.members.find((m) => m.name === 'fn');
		assert(method?.kind === 'function', 'expected a function member');
		assert.strictEqual(method.returnType, 'B');
		assert.strictEqual(method.parameters?.[0]?.type, 'B');
		assert.strictEqual(diagnostics.length, 0, 'no diagnostics for unresolvable types');
	});
});
