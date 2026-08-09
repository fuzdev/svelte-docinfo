/**
 * Tests for diagnostic positions on Svelte modules: query-time diagnostics
 * emitted against a svelte2tsx virtual (`<script module>` extraction) must
 * carry original `.svelte` positions, not the virtual's
 * (`remapVirtualDiagnosticPositions`). Markup above the script makes the two
 * diverge, so a passing exact-line assertion proves the remap ran.
 */

import { test, assert, describe } from 'vitest';
import ts from 'typescript';

import { byKind, type Diagnostic } from '$lib/diagnostics.ts';
import { remapVirtualDiagnosticPositions } from '$lib/svelte.ts';

import { analyzeTestProject } from './test-module-helpers.ts';

/** 1-based line of the first line of `content` containing `needle`. */
const lineOf = (content: string, needle: string): number => {
	const index = content.split('\n').findIndex((line) => line.includes(needle));
	assert.notStrictEqual(index, -1, `expected source to contain ${needle}`);
	return index + 1;
};

describe('script-module diagnostics carry original .svelte positions', () => {
	test('unknown_param remaps to the declaration line below markup', async () => {
		const source = `<div>text</div>
<div>text</div>

<script module lang="ts">
	/**
	 * Description.
	 *
	 * @param b - Description 1
	 */
	export const fn = (a: string): string => a;
</script>
`;
		const { diagnostics } = await analyzeTestProject({ 'src/lib/Widget.svelte': source });
		const unknownParams = byKind(diagnostics, 'unknown_param');
		assert.strictEqual(unknownParams.length, 1);
		const diagnostic = unknownParams[0]!;
		assert.strictEqual(diagnostic.file, 'src/lib/Widget.svelte');
		assert.strictEqual(diagnostic.line, lineOf(source, 'export const fn'));
	});

	test('misplaced_tag on a non-primary overload remaps to the overload line', async () => {
		const source = `<p>text</p>
<p>text</p>
<p>text</p>

<script module lang="ts">
	export function fn(a: string): string;
	/**
	 * @deprecated Description 1
	 */
	export function fn(a: number): number;
	export function fn(a: string | number): string | number {
		return a;
	}
</script>
`;
		const { diagnostics } = await analyzeTestProject({ 'src/lib/Widget.svelte': source });
		const misplaced = byKind(diagnostics, 'misplaced_tag');
		assert.strictEqual(misplaced.length, 1);
		const diagnostic = misplaced[0]!;
		assert.strictEqual(diagnostic.file, 'src/lib/Widget.svelte');
		assert.strictEqual(diagnostic.line, lineOf(source, 'fn(a: number)'));
	});

	test('a diagnostic emitted against another component virtual remaps through that map', async () => {
		// The rename re-export synthesizes its alias by re-analyzing the
		// canonical in Other's virtual — that diagnostic carries Other's virtual
		// path and must remap through Other's source map, not Widget's.
		const other = `<span>text</span>
<span>text</span>

<script module lang="ts">
	/**
	 * Description.
	 *
	 * @param b - Description 1
	 */
	export const fn = (a: string): string => a;
</script>
`;
		const widget = `<script module lang="ts">
	export { fn as gn } from './Other.svelte';
</script>

<div>text</div>
`;
		const { diagnostics } = await analyzeTestProject({
			'src/lib/Other.svelte': other,
			'src/lib/Widget.svelte': widget
		});
		const unknownParams = byKind(diagnostics, 'unknown_param');
		assert.ok(unknownParams.length >= 1, 'expected unknown_param diagnostics');
		const expectedLine = lineOf(other, 'export const fn');
		for (const diagnostic of unknownParams) {
			assert.strictEqual(diagnostic.file, 'src/lib/Other.svelte');
			assert.strictEqual(diagnostic.line, expectedLine);
		}
	});

	test('TypeScript module diagnostics keep their own positions', async () => {
		const source = `/**
 * Description.
 *
 * @param b - Description 1
 */
export const fn = (a: string): string => a;
`;
		const { diagnostics } = await analyzeTestProject({ 'src/lib/a.ts': source });
		const unknownParams = byKind(diagnostics, 'unknown_param');
		assert.strictEqual(unknownParams.length, 1);
		const diagnostic = unknownParams[0]!;
		assert.strictEqual(diagnostic.file, 'src/lib/a.ts');
		assert.strictEqual(diagnostic.line, lineOf(source, 'export const fn'));
	});
});

describe('remapVirtualDiagnosticPositions', () => {
	test('drops line/column when the virtual has no source map', () => {
		const diagnostics: Array<Diagnostic> = [
			{
				kind: 'unknown_param',
				file: '/p/src/lib/A.svelte.__svelte2tsx__.ts',
				line: 3,
				column: 5,
				message: 'msg',
				severity: 'warning',
				paramName: 'b',
				functionName: 'fn'
			}
		];
		remapVirtualDiagnosticPositions(diagnostics, [
			{
				virtualPath: '/p/src/lib/A.svelte.__svelte2tsx__.ts',
				content: '',
				sourceMap: null,
				scriptKind: ts.ScriptKind.TS
			}
		]);
		assert.strictEqual(diagnostics[0]!.line, undefined);
		assert.strictEqual(diagnostics[0]!.column, undefined);
	});

	test('leaves non-virtual files untouched', () => {
		const diagnostics: Array<Diagnostic> = [
			{
				kind: 'unknown_param',
				file: '/p/src/lib/a.ts',
				line: 3,
				column: 5,
				message: 'msg',
				severity: 'warning',
				paramName: 'b',
				functionName: 'fn'
			}
		];
		remapVirtualDiagnosticPositions(diagnostics, [
			{
				virtualPath: '/p/src/lib/A.svelte.__svelte2tsx__.ts',
				content: '',
				sourceMap: null,
				scriptKind: ts.ScriptKind.TS
			}
		]);
		assert.strictEqual(diagnostics[0]!.line, 3);
		assert.strictEqual(diagnostics[0]!.column, 5);
	});
});
