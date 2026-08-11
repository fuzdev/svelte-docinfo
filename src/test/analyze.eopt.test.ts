/**
 * Tests for extraction under `exactOptionalPropertyTypes`.
 *
 * Under the flag the checker doesn't widen optional properties, so every
 * `undefined` in a property type is author-written and the optional-widening
 * strip is gated off at property sites (`optionalWidened` in
 * `typescript-extract-shared.ts`): a written `x?: T | undefined` survives, a
 * type-parameter union isn't rebuilt through `getNonNullableType`, and a
 * written `fn?: (() => void) | undefined` demotes to `kind: 'variable'` like
 * the `| null` forms. Optional parameters and tuple elements widen under both
 * modes, so their strips stay unconditional. The widening-mode behavior is
 * locked by `analyze.optionals.test.ts` and the fixture suite.
 */

import { test, assert, describe } from 'vitest';
import { join } from 'node:path';

import type { MemberJson, ModuleJson, TypeJson } from '$lib/types.ts';
import { createSourceOptions } from '$lib/source-config.ts';
import { createAnalysisSession } from '$lib/session.ts';

import { TEST_TSCONFIG_COMPILER_OPTIONS, withTestProject } from './test-helpers.ts';
import { analyzeTestProject } from './test-module-helpers.ts';

/**
 * `createTestProject`'s default tsconfig plus `exactOptionalPropertyTypes`
 * (which requires `strictNullChecks`, satisfied via `strict`). Supplying the
 * file suppresses the default, so the whole project analyzes under the flag.
 */
const EOPT_TSCONFIG = JSON.stringify({
	compilerOptions: { ...TEST_TSCONFIG_COMPILER_OPTIONS, exactOptionalPropertyTypes: true }
});

/** Analyze a single-file project under `exactOptionalPropertyTypes` and return its module. */
const analyzeEoptFile = async (path: string, content: string): Promise<ModuleJson> => {
	const { modules } = await analyzeTestProject({
		'tsconfig.json': EOPT_TSCONFIG,
		[path]: content
	});
	assert.ok(modules[0], `expected a module for ${path}`);
	return modules[0];
};

const typeSignatures = (members: Array<MemberJson>): Record<string, string | undefined> =>
	Object.fromEntries(members.map((m) => [m.name, m.typeSignature]));

describe('exactOptionalPropertyTypes property types', () => {
	test('keeps written `undefined` members and skips the strip', async () => {
		const module = await analyzeEoptFile(
			'src/lib/a.ts',
			`export type A = {
	a?: string | undefined;
	b?: string | null | undefined;
	c?: string;
	d?: string | null;
	e?: undefined;
	f?: never;
};`
		);

		const declaration = module.declarations[0];
		assert(declaration?.kind === 'type', 'expected a type declaration');

		assert.deepStrictEqual(typeSignatures(declaration.members), {
			// author-written `undefined` — the strip would trim these to `string`
			// and `string | null`
			a: 'string | undefined',
			b: 'string | null | undefined',
			c: 'string',
			d: 'string | null',
			e: 'undefined',
			// no widening under the flag, so the written `never` survives
			// (widening mode collapses `never | undefined` to `undefined`)
			f: 'never'
		});
		assert.deepStrictEqual(
			declaration.members.map((m) => [m.name, m.kind === 'constructor' ? undefined : m.optional]),
			[
				['a', true],
				['b', true],
				['c', true],
				['d', true],
				['e', true],
				['f', true]
			],
			'every member keeps optional: true'
		);
	});

	test('the typeInfo tree keeps the written `undefined` member', async () => {
		const module = await analyzeEoptFile(
			'src/lib/a.ts',
			`export type A = { a?: string | undefined };`
		);

		const declaration = module.declarations[0];
		assert(declaration?.kind === 'type', 'expected a type declaration');
		const a = declaration.members[0];
		assert(a?.kind === 'variable', 'expected a variable member');
		assert(a.typeInfo?.kind === 'union', 'expected a union tree');
		assert.deepStrictEqual(a.typeInfo.members, [
			{ kind: 'intrinsic', text: 'string' },
			{ kind: 'intrinsic', text: 'undefined' }
		]);
	});

	test('does not rebuild a type-parameter union', async () => {
		// the multi-member fallback runs `getNonNullableType`, which rewrites
		// bare type parameters as `E & {}` — corruption when nothing was widened
		const module = await analyzeEoptFile('src/lib/a.ts', `export interface G<E, F> { tp?: E | F }`);

		const declaration = module.declarations[0];
		assert(declaration?.kind === 'interface', 'expected an interface declaration');
		assert.strictEqual(declaration.members[0]?.typeSignature, 'E | F');
	});

	test('class members keep written `undefined`; optional methods classify', async () => {
		const module = await analyzeEoptFile(
			'src/lib/a.ts',
			`export class K {
	x?: string | undefined;
	y?: string;
	m?(): void {}
}`
		);

		const declaration = module.declarations[0];
		assert(declaration?.kind === 'class', 'expected a class declaration');
		assert.deepStrictEqual(typeSignatures(declaration.members), {
			x: 'string | undefined',
			y: 'string',
			// the optional-method strip is identity under the flag (no widening,
			// and method syntax can't write `| undefined`)
			m: '(): void'
		});
		const m = declaration.members.find((member) => member.name === 'm');
		assert(m?.kind === 'function', 'expected a function member');
		assert.strictEqual(m.optional, true);
	});
});

describe('exactOptionalPropertyTypes callability', () => {
	test('classifies optional callable properties by their declared type', async () => {
		const module = await analyzeEoptFile(
			'src/lib/a.ts',
			`export interface C {
	fn1?: () => void;
	fn2?: (() => void) | undefined;
	fn3?: (() => void) | (() => number);
	fn4?: (() => void) | null;
	m?(): void;
}`
		);

		const declaration = module.declarations[0];
		assert(declaration?.kind === 'interface', 'expected an interface declaration');
		const kinds = Object.fromEntries(declaration.members.map((m) => [m.name, m.kind]));
		assert.deepStrictEqual(kinds, {
			// no widening, so the bare function type reports its signature directly
			fn1: 'function',
			// a *written* `| undefined` genuinely isn't callable without a check —
			// demotes like the `| null` form, keeping the union on the wire
			fn2: 'variable',
			// a union of callables carries a combined call signature
			fn3: 'function',
			fn4: 'variable',
			// method syntax can't write `| undefined`; the unconditional method-site
			// strip is identity here
			m: 'function'
		});
		const fn2 = declaration.members.find((m) => m.name === 'fn2');
		assert.strictEqual(fn2?.typeSignature, '(() => void) | undefined');
		const fn4 = declaration.members.find((m) => m.name === 'fn4');
		assert.strictEqual(fn4?.typeSignature, '(() => void) | null');
	});
});

describe('exactOptionalPropertyTypes non-property positions still strip', () => {
	test('optional parameters keep the widening strip', async () => {
		// the flag governs properties only — parameters widen under it, so a
		// written `| undefined` is indistinguishable from the widening and strips.
		//
		// `c` is what makes this discriminating: on a non-union the strip is
		// identity, so `a` and `b` would report the same whether or not the
		// checker widened. A multi-member union takes the `getNonNullableType`
		// fallback, whose `NonNullable<…>` rewrite can only arise from a type
		// that *was* `E | F | undefined` — so the rewrite is the proof widening
		// still happens at parameter positions under the flag.
		//
		// That rewrite is also a defect, unchanged by the flag and pre-existing:
		// the declared type is `E | F`. The property-side sibling
		// (`does not rebuild a type-parameter union` above) escapes it only
		// because the flag lets that site skip the strip entirely — with the flag
		// off, an optional property corrupts the same way. A real fix has to
		// reach the multi-member branch of `optionalWideningTarget`, which needs
		// to separate the printed target from the callability-query target.
		const module = await analyzeEoptFile(
			'src/lib/a.ts',
			`export const f = <E, F>(a?: string, b?: number | undefined, c?: E | F): void => {};`
		);

		const declaration = module.declarations[0];
		assert(declaration?.kind === 'function', 'expected a function declaration');
		assert.deepStrictEqual(
			declaration.parameters.map((p) => [p.name, p.type, p.optional]),
			[
				['a', 'string', true],
				['b', 'number', true],
				['c', 'NonNullable<E> | NonNullable<F>', true]
			]
		);
	});

	test('optional tuple elements keep the widening strip', async () => {
		// tuple elements widen under the flag too — `c` discriminates and carries
		// the same pre-existing rewrite as the parameter case above, here as the
		// structured `NonNullable` intersections the flat string prints
		const module = await analyzeEoptFile(
			'src/lib/a.ts',
			`export type T<E, F> = [a: string, b?: number, c?: E | F];`
		);

		const declaration = module.declarations[0];
		assert(declaration?.kind === 'type', 'expected a type declaration');
		assert(declaration.typeInfo?.kind === 'tuple', 'expected a tuple tree');
		const nonNullable = (name: string): TypeJson => ({
			kind: 'intersection',
			alias: 'NonNullable',
			members: [
				{ kind: 'other', text: name },
				{ kind: 'object', text: '{}' }
			]
		});
		assert.deepStrictEqual(declaration.typeInfo.elements, [
			{ name: 'a', type: { kind: 'intrinsic', text: 'string' } },
			{ name: 'b', type: { kind: 'intrinsic', text: 'number' }, optional: true },
			{
				name: 'c',
				type: { kind: 'union', members: [nonNullable('E'), nonNullable('F')] },
				optional: true
			}
		]);
	});

	test('snippet tuple parameters keep the widening strip', async () => {
		// local `Snippet`-shaped interface per the `analyze.optionals.test.ts`
		// pattern — `svelte` doesn't resolve from the temp project dir
		const module = await analyzeEoptFile(
			'src/lib/A.svelte',
			`<script lang="ts">
interface Snippet<T extends Array<unknown>> {(...args: T): void}
let {s}: {s?: Snippet<[c?: string]>} = $props();
</script>
<div>{String(s)}</div>`
		);

		const declaration = module.declarations[0];
		assert(declaration?.kind === 'component', 'expected a component declaration');
		const s = declaration.props.find((p) => p.name === 's');
		assert.ok(s?.parameters, 'expected snippet parameters');
		assert.deepStrictEqual(
			s.parameters.map((p) => [p.name, p.type, p.optional]),
			[['c', 'string', true]]
		);
	});
});

describe('exactOptionalPropertyTypes component props', () => {
	test('keeps written `undefined` in prop types', async () => {
		const module = await analyzeEoptFile(
			'src/lib/A.svelte',
			`<script lang="ts">
let {a, b, c}: {
	a?: string | undefined;
	b?: string;
	c?: (() => void) | undefined;
} = $props();
</script>
<div>{a}{b}{String(c)}</div>`
		);

		const declaration = module.declarations[0];
		assert(declaration?.kind === 'component', 'expected a component declaration');
		assert.deepStrictEqual(
			declaration.props.map((p) => [p.name, p.type, p.optional]),
			[
				['a', 'string | undefined', true],
				['b', 'string', true],
				['c', '(() => void) | undefined', true]
			]
		);
	});
});

describe('exactOptionalPropertyTypes via session compilerOptions', () => {
	test('a session-level override reaches extraction', async () => {
		// the flag merges per-key over the project tsconfig (which doesn't set
		// it) — locking that the merged config, not the raw tsconfig, gates the
		// strip
		const content = `export type A = { x?: string | undefined };`;
		await withTestProject({ 'src/lib/a.ts': content }, async (projectRoot) => {
			const session = createAnalysisSession({
				sourceOptions: createSourceOptions(projectRoot),
				compilerOptions: { exactOptionalPropertyTypes: true }
			});
			try {
				await session.setFiles([{ id: join(projectRoot, 'src/lib/a.ts'), content }]);
				const result = session.query();
				const declaration = result.modules[0]?.declarations[0];
				assert(declaration?.kind === 'type', 'expected a type declaration');
				assert.strictEqual(declaration.members[0]?.typeSignature, 'string | undefined');
			} finally {
				session.dispose();
			}
		});
	});
});
