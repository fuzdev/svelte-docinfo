/**
 * Tests for the `@internal` marker: `internalMessage` on declarations and
 * members (presence = tagged, empty string for a bare tag, trailing prose
 * kept), the marker-not-exclusion contract (the declaration stays documented,
 * unlike `@nodocs`), and the symbol-scope `misplaced_tag` warning on
 * non-primary overloads.
 */

import { test, assert, describe } from 'vitest';

import type { ModuleJson } from '$lib/types.ts';
import type { AnalyzeResultJson } from '$lib/analyze-core.ts';
import { byKind } from '$lib/diagnostics.ts';

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

describe('@internal on declarations', () => {
	test('trailing prose lands in internalMessage, separate from docComment', async () => {
		const module = await analyzeFile(`/**
 * Parses things.
 *
 * @internal used during development to seed the cache
 */
export const parse_things = (): void => {};`);
		const declaration = module.declarations.find((d) => d.name === 'parse_things');
		assert.ok(declaration, 'expected the declaration');
		assert.strictEqual(declaration.internalMessage, 'used during development to seed the cache');
		assert.strictEqual(declaration.docComment, 'Parses things.');
	});

	test('a bare tag yields an empty string', async () => {
		const module = await analyzeFile(`/**
 * Docs.
 *
 * @internal
 */
export interface Thing {
	a: string;
}`);
		const declaration = module.declarations.find((d) => d.name === 'Thing');
		assert.ok(declaration, 'expected the declaration');
		assert.strictEqual(declaration.internalMessage, '');
	});

	test('marker, not exclusion — the declaration stays in output', async () => {
		const module = await analyzeFile(`/** @internal */
export const kept = 1;
/** @nodocs */
export const dropped = 2;`);
		assert.ok(module.declarations.find((d) => d.name === 'kept'));
		assert.notOk(module.declarations.find((d) => d.name === 'dropped'));
	});

	test('untagged declarations carry no internalMessage', async () => {
		const module = await analyzeFile(`/** Docs. */
export const plain = 1;`);
		const declaration = module.declarations.find((d) => d.name === 'plain');
		assert.ok(declaration, 'expected the declaration');
		assert.strictEqual(declaration.internalMessage, undefined);
	});
});

describe('@internal on members', () => {
	test('interface properties and class methods carry internalMessage', async () => {
		const module = await analyzeFile(`export interface I {
	/** @internal escape hatch */
	raw: unknown;
}
export class C {
	/** @internal */
	helper(): void {}
}`);
		const iface = module.declarations.find((d) => d.name === 'I');
		assert(iface?.kind === 'interface', 'expected an interface declaration');
		assert.strictEqual(
			iface.members.find((m) => m.name === 'raw')?.internalMessage,
			'escape hatch'
		);
		const cls = module.declarations.find((d) => d.name === 'C');
		assert(cls?.kind === 'class', 'expected a class declaration');
		assert.strictEqual(cls.members.find((m) => m.name === 'helper')?.internalMessage, '');
	});
});

describe('@internal on components', () => {
	test('in-script JSDoc above $props() carries the marker', async () => {
		const { modules } = await analyzeTestProject({
			'src/lib/Widget.svelte': `<script lang="ts">
	/**
	 * A widget.
	 *
	 * @internal not part of the design system yet
	 */
	const { label }: { label: string } = $props();
</script>
<button>{label}</button>`
		});
		const declaration = modules[0]?.declarations.find((d) => d.name === 'Widget');
		assert(declaration?.kind === 'component', 'expected a component declaration');
		assert.strictEqual(declaration.internalMessage, 'not part of the design system yet');
		assert.strictEqual(declaration.docComment, 'A widget.');
	});
});

describe('@internal on overloads', () => {
	test('a non-primary overload emits misplaced_tag and drops the marker', async () => {
		const { modules, diagnostics } = await analyzeSource(`/**
 * Converts values.
 */
export function convert(a: string): number;
/** @internal */
export function convert(a: number): string;
export function convert(a: string | number): number | string {
	return typeof a === 'string' ? 1 : 'x';
}`);
		const declaration = modules[0]?.declarations.find((d) => d.name === 'convert');
		assert.ok(declaration, 'expected the declaration');
		assert.strictEqual(declaration.internalMessage, undefined);
		const misplaced = byKind(diagnostics, 'misplaced_tag');
		assert.strictEqual(misplaced.length, 1);
		assert.strictEqual(misplaced[0]!.tagName, 'internal');
		assert.strictEqual(misplaced[0]!.functionName, 'convert');
	});

	test('the primary overload feeds the parent like other symbol-scope tags', async () => {
		const { modules, diagnostics } = await analyzeSource(`/**
 * Converts values.
 *
 * @internal
 */
export function convert(a: string): number;
export function convert(a: number): string;
export function convert(a: string | number): number | string {
	return typeof a === 'string' ? 1 : 'x';
}`);
		const declaration = modules[0]?.declarations.find((d) => d.name === 'convert');
		assert.ok(declaration, 'expected the declaration');
		assert.strictEqual(declaration.internalMessage, '');
		assert.strictEqual(byKind(diagnostics, 'misplaced_tag').length, 0);
	});
});
