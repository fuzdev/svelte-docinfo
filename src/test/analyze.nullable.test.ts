/**
 * Tests for optional declarations whose type includes `null`, under
 * `strictNullChecks`.
 *
 * The checker widens every optional property to include `undefined`, and the
 * signature-building code strips that back off. Stripping it with
 * `checker.getNonNullableType` also drops `null` — `a?: string | null` printed as
 * `"string"`, `a?: null` as `"never"` — so `getOptionalTypeSignature` removes only
 * the `undefined` member. These exercise the whole `analyze` pipeline; the
 * extractors are covered directly by the `ts/types/nullable-optional` and
 * `svelte/props/nullable` fixtures.
 */

import { test, assert, describe } from 'vitest';
import { join } from 'node:path';

import { analyze } from '$lib/analyze.ts';
import { createSourceOptions } from '$lib/source-config.ts';
import type { ComponentPropJson, MemberJson, ModuleJson } from '$lib/types.ts';

import { withTestProject } from './test-helpers.ts';

/** Analyze a single-file project and return its module. */
const analyzeFile = async (path: string, content: string): Promise<ModuleJson> => {
	const files = { [path]: content };
	let module: ModuleJson | undefined;
	await withTestProject(files, async (projectRoot) => {
		const { modules } = await analyze({
			sourceFiles: [{ id: join(projectRoot, path), content }],
			sourceOptions: createSourceOptions(projectRoot)
		});
		module = modules[0];
	});
	assert.ok(module, `expected a module for ${path}`);
	return module;
};

const typeSignatures = (members: Array<MemberJson>): Record<string, string | undefined> =>
	Object.fromEntries(members.map((m) => [m.name, m.typeSignature]));

const propTypes = (props: Array<ComponentPropJson>): Record<string, string> =>
	Object.fromEntries(props.map((p) => [p.name, p.type]));

describe('optional members with `null`', () => {
	test('keeps `null` in type-alias property signatures', async () => {
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
};`
		);

		const declaration = module.declarations[0];
		assert.strictEqual(declaration?.kind, 'type');
		if (declaration?.kind !== 'type') throw new Error('expected a type declaration');

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
			g: 'string | null'
		});
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
		assert.strictEqual(declaration?.kind, 'interface');
		if (declaration?.kind !== 'interface') throw new Error('expected an interface declaration');

		const member = declaration.members[0];
		assert.ok(member, 'expected a member');
		assert.strictEqual(member.kind, 'function');
		if (member.kind !== 'function') throw new Error('expected a function member');
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
		assert.strictEqual(declaration?.kind, 'component');
		if (declaration?.kind !== 'component') throw new Error('expected a component declaration');

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
		assert.strictEqual(declaration?.kind, 'component');
		if (declaration?.kind !== 'component') throw new Error('expected a component declaration');

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
let {a}: {a?: Snippet<[b: string]> | null} = $props();
</script>
<div>{@render a?.('c')}</div>`
		);

		const declaration = module.declarations[0];
		assert.strictEqual(declaration?.kind, 'component');
		if (declaration?.kind !== 'component') throw new Error('expected a component declaration');

		const prop = declaration.props[0];
		assert.ok(prop, 'expected a prop');
		assert.strictEqual(prop.type, 'Snippet<[b: string]> | null');
		assert.deepStrictEqual(
			prop.parameters?.map((p) => [p.name, p.type]),
			[['b', 'string']]
		);
	});
});
