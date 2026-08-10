/**
 * Tests for diagnostic positions on Svelte modules: a published position must
 * be an original `.svelte` one, never the svelte2tsx virtual's, and absent
 * when it can't be mapped. Markup above the script makes the two coordinate
 * systems diverge, so a passing exact-line assertion proves a mapping ran.
 *
 * Two mechanisms, split by which file the diagnostic names: those emitted
 * against the virtual (`<script module>` extraction) remap in batch via
 * `remapVirtualDiagnosticPositions`, while `svelte_prop_failed` names the
 * original `.svelte` and maps at its emission site.
 */

import { test, assert, describe } from 'vitest';
import ts from 'typescript';
import { TraceMap } from '@jridgewell/trace-mapping';
import { dirname, join } from 'node:path';

import { byKind, type Diagnostic } from '$lib/diagnostics.ts';
import {
	analyzeSvelteModule,
	remapVirtualDiagnosticPositions,
	type SvelteVirtualFile
} from '$lib/svelte.ts';

import {
	analyzeTestProject,
	createCachedAnalysisProgram,
	createTestSourceOptions,
	transformOrThrow
} from './test-module-helpers.ts';

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

describe('svelte_prop_failed positions', () => {
	// Markup above the script so the original line and the virtual line (where
	// svelte2tsx hoists the interface) can't coincide.
	const SOURCE = `<div>text</div>
<div>text</div>

<script lang="ts">
	interface Props {
		a: string;
	}
	let {a}: Props = $props();
</script>
`;
	// rooted in the repo so the component's own props aren't judged external
	const ID = join(process.cwd(), 'src/lib/PropProbe.svelte');

	/**
	 * A checker that throws when asked for the named prop's type, driving
	 * `extractPropsViaChecker`'s catch — the only route to the diagnostic, and
	 * one no real component reaches (all three emission sites are catch
	 * branches).
	 */
	const throwingChecker = (checker: ts.TypeChecker, propName: string): ts.TypeChecker =>
		new Proxy(checker, {
			get(target, key, receiver) {
				if (key === 'getTypeOfSymbolAtLocation') {
					return (symbol: ts.Symbol, node: ts.Node) => {
						if (symbol.name === propName) throw new Error('synthetic resolution failure');
						return target.getTypeOfSymbolAtLocation(symbol, node);
					};
				}
				const value = Reflect.get(target, key, receiver);
				return typeof value === 'function' ? value.bind(target) : value;
			}
		});

	/** Analyze `SOURCE`, optionally with every virtual position made unmappable. */
	const analyzeWithFailingProp = (unmappable: boolean): Array<Diagnostic> => {
		const sourceFile = { id: ID, content: SOURCE };
		const virtual = transformOrThrow(sourceFile);
		const program = createCachedAnalysisProgram(new Map([[virtual.virtualPath, virtual]]));
		const diagnostics: Array<Diagnostic> = [];
		analyzeSvelteModule(
			sourceFile,
			'PropProbe.svelte',
			throwingChecker(program.getTypeChecker(), 'a'),
			createTestSourceOptions(dirname(ID)),
			diagnostics,
			program,
			// a mappings-less map stands in for a node svelte2tsx synthesized:
			// present, but resolving nothing
			unmappable
				? {
						...virtual,
						sourceMap: new TraceMap({ version: 3, sources: [ID], names: [], mappings: '' })
					}
				: virtual
		);
		return byKind(diagnostics, 'svelte_prop_failed');
	};

	test('a mappable prop declaration carries the original .svelte line', () => {
		const failures = analyzeWithFailingProp(false);
		assert.strictEqual(failures.length, 1);
		assert.strictEqual(failures[0]!.line, lineOf(SOURCE, 'a: string;'));
	});

	test('an unmappable prop declaration drops line/column instead of publishing a virtual line', () => {
		const failures = analyzeWithFailingProp(true);
		assert.strictEqual(failures.length, 1);
		const diagnostic = failures[0]!;
		assert.strictEqual(diagnostic.file, ID);
		assert.strictEqual(diagnostic.line, undefined);
		assert.strictEqual(diagnostic.column, undefined);
	});
});

describe('remapVirtualDiagnosticPositions', () => {
	const VIRTUAL: SvelteVirtualFile = {
		virtualPath: '/p/src/lib/A.svelte.__svelte2tsx__.ts',
		content: '',
		sourceMap: null,
		scriptKind: ts.ScriptKind.TS
	};
	const diagnosticFor = (file: string): Diagnostic => ({
		kind: 'unknown_param',
		file,
		line: 3,
		column: 5,
		message: 'msg',
		severity: 'warning',
		paramName: 'b',
		functionName: 'fn'
	});

	test('drops unmappable virtual positions, leaves non-virtual files untouched', () => {
		// one batch call — the pass discriminates by `file` within a batch
		const virtualDiagnostic = diagnosticFor(VIRTUAL.virtualPath);
		const plainDiagnostic = diagnosticFor('/p/src/lib/a.ts');
		remapVirtualDiagnosticPositions([virtualDiagnostic, plainDiagnostic], [VIRTUAL]);
		assert.strictEqual(virtualDiagnostic.line, undefined);
		assert.strictEqual(virtualDiagnostic.column, undefined);
		assert.strictEqual(plainDiagnostic.line, 3);
		assert.strictEqual(plainDiagnostic.column, 5);
	});
});
