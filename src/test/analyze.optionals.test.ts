/**
 * Tests for optional declarations whose type includes `null`, plus adjacent
 * optional-widening edge cases, under `strictNullChecks`.
 *
 * The checker widens every optional property to include `undefined`, and the
 * signature-building code strips that back off. Stripping it with
 * `checker.getNonNullableType` also drops `null` — `a?: string | null` printed as
 * `"string"`, `a?: null` as `"never"` — so `getTypeSignature` removes only
 * the `undefined` member, and only from a union: `a?: undefined` stays
 * `"undefined"` (stripping would leave `never` too) and `a?: unknown` stays
 * `"unknown"` (`unknown` absorbs the widening; stripping would leave `{}`).
 * These exercise the whole `analyze` pipeline;
 * the extractors are covered directly by the `ts/types/nullable-optional` and
 * `svelte/props/nullable` fixtures.
 */

import { test, assert, describe } from 'vitest';

import type { ComponentPropJson, MemberJson, ModuleJson } from '$lib/types.ts';

import { analyzeTestProject } from './test-module-helpers.ts';

/** Analyze a single-file project and return its module. */
const analyzeFile = async (path: string, content: string): Promise<ModuleJson> => {
	const { modules } = await analyzeTestProject({ [path]: content });
	assert.ok(modules[0], `expected a module for ${path}`);
	return modules[0];
};

const typeSignatures = (members: Array<MemberJson>): Record<string, string | undefined> =>
	Object.fromEntries(members.map((m) => [m.name, m.typeSignature]));

const propTypes = (props: Array<ComponentPropJson>): Record<string, string> =>
	Object.fromEntries(props.map((p) => [p.name, p.type]));

describe('optional type normalization', () => {
	test('normalizes optional type-alias property signatures', async () => {
		const module = await analyzeFile(
			'src/lib/a.ts',
			`export type A = {
	a?: null;
	b?: string | null;
	c?: (() => void) | null;
	d?: null | undefined;
	e?: string;
	f?: () => void;
	g: string | null;
	h?: undefined;
	i?: (() => void) | (() => number);
	j?: unknown;
	k?: any;
};`
		);

		const declaration = module.declarations[0];
		assert(declaration?.kind === 'type', 'expected a type declaration');

		assert.deepStrictEqual(typeSignatures(declaration.members), {
			a: 'null',
			b: 'string | null',
			// parens are load-bearing — `() => void | null` would parse as a different type
			c: '(() => void) | null',
			d: 'null',
			e: 'string',
			// a callable member, rendered from its signature — `getNonOptionalType`
			// strips the `undefined` that would otherwise hide the call signatures
			f: '(): void',
			g: 'string | null',
			// the whole type is the widening — stripping would leave `never`
			h: 'undefined',
			// a union of callables is itself callable; `getNonNullableType` rebuilds
			// the union so the combined call signature survives
			i: '(): number | void',
			// `unknown` absorbs the widening rather than unioning with it, so there's
			// no member to strip — and `getNonNullableType` would answer `{}`
			j: 'unknown',
			k: 'any'
		});
	});

	test('keeps a non-union optional parameter as written', async () => {
		// the same absorption on the parameter path, which has no
		// `exactOptionalPropertyTypes` escape hatch
		const module = await analyzeFile('src/lib/a.ts', `export const f = (a?: unknown): void => {};`);

		const declaration = module.declarations[0];
		assert(declaration?.kind === 'function', 'expected a function declaration');
		assert.deepStrictEqual(
			declaration.parameters.map((p) => [p.name, p.type, p.optional]),
			[['a', 'unknown', true]]
		);
	});

	test('keeps call signatures on an optional method', async () => {
		// `fn?(): T` resolves to a union with `undefined`, which reports no call
		// signatures — the member used to ship with none of the callable fields
		const module = await analyzeFile(
			'src/lib/a.ts',
			`export interface A {
	fn?(a: string): number;
}`
		);

		const declaration = module.declarations[0];
		assert(declaration?.kind === 'interface', 'expected an interface declaration');

		const member = declaration.members[0];
		assert(member?.kind === 'function', 'expected a function member');
		assert.strictEqual(member.optional, true);
		assert.strictEqual(member.typeSignature, '(a: string): number');
		assert.strictEqual(member.returnType, 'number');
		assert.deepStrictEqual(
			member.parameters.map((p) => [p.name, p.type]),
			[['a', 'string']]
		);
	});

	test('keeps `null` in component prop types', async () => {
		const module = await analyzeFile(
			'src/lib/A.svelte',
			`<script lang="ts">
let {a, b, c, d, e, f}: {
	a?: null;
	b?: string | null;
	c?: (() => void) | null;
	d?: null | undefined;
	e?: string;
	f?: () => void;
} = $props();
</script>
<div>{a}{b}{c}{d}{e}{f}</div>`
		);

		const declaration = module.declarations[0];
		assert(declaration?.kind === 'component', 'expected a component declaration');

		assert.deepStrictEqual(propTypes(declaration.props), {
			a: 'null',
			b: 'string | null',
			// parens are load-bearing — `() => void | null` would parse as a different type
			c: '(() => void) | null',
			d: 'null',
			e: 'string',
			f: '() => void'
		});
	});

	test('preserves the alias name rather than expanding a nullable alias', async () => {
		const module = await analyzeFile(
			'src/lib/A.svelte',
			`<script lang="ts">
type A = {a: string} | null;
let {a, b}: {a?: A; b: A} = $props();
</script>
<div>{a}{b}</div>`
		);

		const declaration = module.declarations[0];
		assert(declaration?.kind === 'component', 'expected a component declaration');

		// the optional prop prints like the required one — stripping optionality
		// through `getNonNullableType` used to rebuild the union and lose the alias
		assert.deepStrictEqual(propTypes(declaration.props), { a: 'A', b: 'A' });
	});

	test('extracts snippet parameters through a nullable snippet prop', async () => {
		// `Snippet` is declared locally rather than imported from `svelte`, which
		// does not resolve from the temporary project directory. Detection keys off
		// the printed type string and the type arguments on the reference, so a
		// local interface of the same shape exercises the same path.
		const module = await analyzeFile(
			'src/lib/A.svelte',
			`<script lang="ts">
interface Snippet<T extends Array<unknown>> {(...args: T): void}
let {a, b}: {
	a?: Snippet<[c: string]> | null;
	b: Snippet<[d: string]> | null;
} = $props();
</script>
<div>{@render a?.('e')}{@render b?.('e')}</div>`
		);

		const declaration = module.declarations[0];
		assert(declaration?.kind === 'component', 'expected a component declaration');

		const [a, b] = declaration.props;
		assert.ok(a && b, 'expected two props');
		assert.strictEqual(a.type, 'Snippet<[c: string]> | null');
		assert.deepStrictEqual(
			a.parameters?.map((p) => [p.name, p.type]),
			[['c', 'string']]
		);
		// a required nullable snippet reveals its parameters too — the strip before
		// extraction is unconditional, not gated on optionality
		assert.strictEqual(b.type, 'Snippet<[d: string]> | null');
		assert.deepStrictEqual(
			b.parameters?.map((p) => [p.name, p.type]),
			[['d', 'string']]
		);
	});

	test('strips the widened `undefined` from optional snippet tuple elements', async () => {
		const module = await analyzeFile(
			'src/lib/A.svelte',
			`<script lang="ts">
interface Snippet<T extends Array<unknown>> {(...args: T): void}
let {a}: {a?: Snippet<[b: string, c?: number]>} = $props();
</script>
<div>{@render a?.('d')}</div>`
		);

		const declaration = module.declarations[0];
		assert(declaration?.kind === 'component', 'expected a component declaration');

		const prop = declaration.props[0];
		assert.ok(prop, 'expected a prop');
		// the prop's `type` is the checker's canonical rendering — nested positions
		// keep the widening (see the `optional` notes in CLAUDE.md)
		assert.strictEqual(prop.type, 'Snippet<[b: string, c?: number | undefined]>');
		assert.deepStrictEqual(
			prop.parameters?.map((p) => [p.name, p.type, p.optional]),
			[
				['b', 'string', false],
				['c', 'number', true]
			]
		);
	});
});
