/**
 * Tests for member extraction shapes across the container kinds: literal
 * property names (unquoted, matching the symbol-based paths), `readonly`
 * index signatures, `genericParams` on callable properties, the
 * `misplaced_tag` for a `@default` dropped by callable classification, and
 * graceful degradation when a member's type is unresolvable (replacing the
 * old `errors/*` fixture category, which ran no extractor and asserted
 * nothing).
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

	test('`@default` dropped by callable classification surfaces as misplaced_tag', async () => {
		// `defaultValue` is schema-allowed on variable members only; a callable
		// property flips to a function member, so the tag is dropped — with a
		// warning, per the no-silent-doc-loss policy
		const { modules, diagnostics } = await analyzeSource(`export interface I {
	/**
	 * A callable option.
	 *
	 * @default noop
	 */
	fn: () => void;
	/**
	 * A plain option.
	 *
	 * @default 3
	 */
	limit: number;
}`);
		const declaration = modules[0]?.declarations[0];
		assert(declaration?.kind === 'interface', 'expected an interface declaration');
		const fn = declaration.members.find((m) => m.name === 'fn');
		assert(fn?.kind === 'function', 'expected a function member');
		assert.strictEqual(fn.docComment, 'A callable option.');
		assert.ok(!('defaultValue' in fn), 'expected no defaultValue on a function member');
		const misplaced = diagnostics.find((d) => d.kind === 'misplaced_tag');
		assert.ok(misplaced, 'expected a misplaced_tag diagnostic');
		assert(misplaced.kind === 'misplaced_tag');
		assert.strictEqual(misplaced.tagName, 'default');
		assert.strictEqual(misplaced.functionName, 'fn');
		// the variable member keeps its @default — no diagnostic for it
		const limit = declaration.members.find((m) => m.name === 'limit');
		assert(limit?.kind === 'variable', 'expected a variable member');
		assert.strictEqual(limit.defaultValue, '3');
		assert.strictEqual(diagnostics.filter((d) => d.kind === 'misplaced_tag').length, 1);
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
