/**
 * Tests for the base `Diagnostic.file` is measured from.
 *
 * The contract (`diagnostics.ts`) is project-root-relative, so rejoining with
 * `projectRoot` recovers the original path. Producers inside the pipeline may
 * write absolute or virtual paths and `normalizeDiagnosticPaths` rewrites
 * them — but a producer writing a *module* path (relative to `sourceRoot`)
 * slips through untouched, because normalization leaves an already-relative
 * path alone. That made the same file report under two names in one result:
 * `Widget.svelte` from the Svelte layer beside `src/lib/Widget.svelte` from
 * the extractors, under the default `sourceRoot` of `src/lib`.
 *
 * `ModuleJson.path` and `Diagnostic.file` are deliberately different bases;
 * these lock the diagnostic one against every producer, so consumers grouping
 * by `file` see one bucket per file.
 *
 * Positions (line/column) on the same diagnostics are
 * `analyze.svelte-diagnostics.test.ts`; the normalization pass itself has
 * units in `analyze.module-paths.test.ts`.
 */

import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, assert, describe } from 'vitest';

import ts from 'typescript';

import { analyze, analyzeFromFiles } from '$lib/analyze.ts';
import { analyzeCore } from '$lib/analyze-core.ts';
import { byKind } from '$lib/diagnostics.ts';
import { createSourceOptions } from '$lib/source-config.ts';
import { SVELTE_VIRTUAL_SUFFIX } from '$lib/source.ts';
import type { SvelteVirtualFile } from '$lib/svelte.ts';

import { withTestProject } from './test-helpers.ts';
import {
	analyzeTestProject,
	createCachedAnalysisProgram,
	testSourceOptions
} from './test-module-helpers.ts';

/** A Svelte component whose HTML `@component` comment duplicates its in-script JSDoc. */
const DUPLICATE_COMMENT_COMPONENT = `<!-- @component HTML doc. -->
<script lang="ts">
	/** In-script doc. */
	let {a}: {a: string} = $props();
</script>
`;

/** A module comment carrying the inert `@nodocs`, which warns wherever it appears. */
const NODOCS_MODULE_COMMENT_TS = `/**
 * @module
 * @nodocs
 */

export const x = 1;
`;

/** The same inert `@nodocs` module comment, in a component's HTML comment. */
const NODOCS_MODULE_COMMENT_SVELTE = `<!--
	@module
	@nodocs
-->
<script lang="ts">
	let {a}: {a: string} = $props();
</script>
`;

/** Analyze every file already written under the project's `src/lib`. */
const analyzeProject = async (projectRoot: string) => {
	const dir = join(projectRoot, 'src/lib');
	const names = await readdir(dir);
	return analyze({
		sourceFiles: await Promise.all(
			names.map(async (name) => ({
				id: join(dir, name),
				content: await readFile(join(dir, name), 'utf8')
			}))
		),
		sourceOptions: createSourceOptions(projectRoot)
	});
};

describe('Diagnostic.file rejoins with projectRoot', () => {
	test('every diagnostic names a file that exists on disk', async () => {
		// The base-independent form of the contract, and the one assertion that
		// covers every producer at once: whatever base a diagnostic used, if
		// `projectRoot` + `file` resolves then it was the project root.
		await withTestProject(
			{
				// duplicate_comment (Svelte layer) + unknown_param (extractor)
				'src/lib/Widget.svelte': `<!-- @component HTML doc. -->
<script module lang="ts">
	/**
	 * Description.
	 *
	 * @param nope - no such parameter
	 */
	export const fn = (a: string): string => a;
</script>
<script lang="ts">
	/** In-script doc. */
	let {a}: {a: string} = $props();
</script>
`,
				// legacy_props (Svelte layer)
				'src/lib/Legacy.svelte': `<script lang="ts">\n\texport let prop1: string;\n</script>\n`,
				// misplaced_tag from a module comment (Svelte layer)
				'src/lib/Nodocs.svelte': NODOCS_MODULE_COMMENT_SVELTE,
				// misplaced_tag from a module comment (TypeScript path)
				'src/lib/nodocs.ts': NODOCS_MODULE_COMMENT_TS,
				// duplicate_declaration (postprocess)
				'src/lib/a.ts': `export const dup = 1;`,
				'src/lib/b.ts': `export const dup = 2;`
			},
			async (projectRoot) => {
				const { diagnostics } = await analyzeProject(projectRoot);

				// guard against the assertions passing vacuously
				assert.isAtLeast(diagnostics.length, 5);
				const kinds = new Set(diagnostics.map((d) => d.kind));
				for (const kind of [
					'duplicate_comment',
					'legacy_props',
					'misplaced_tag',
					'unknown_param',
					'duplicate_declaration'
				]) {
					assert.ok(kinds.has(kind as never), `expected a ${kind} diagnostic, got ${[...kinds]}`);
				}

				for (const d of diagnostics) {
					assert.ok(
						existsSync(join(projectRoot, d.file)),
						`${d.kind} file "${d.file}" does not resolve from projectRoot`
					);
				}
			}
		);
	});

	test('no diagnostic file is a module path', async () => {
		// The generic guard: `sourceRoot` is `src/lib` here, so the two bases
		// produce disjoint strings and any producer writing a `ModuleJson.path`
		// into `file` collides. Catches a future kind without naming it.
		await withTestProject(
			{
				'src/lib/Legacy.svelte': `<script lang="ts">\n\texport let prop1: string;\n</script>\n`,
				'src/lib/nodocs.ts': NODOCS_MODULE_COMMENT_TS,
				'src/lib/a.ts': `export const dup = 1;`,
				'src/lib/b.ts': `export const dup = 2;`
			},
			async (projectRoot) => {
				const { modules, diagnostics } = await analyzeProject(projectRoot);
				assert.isAtLeast(diagnostics.length, 3);
				const modulePaths = new Set(modules.map((m) => m.path));
				assert.ok(modulePaths.size > 0);
				for (const d of diagnostics) {
					assert.isFalse(
						modulePaths.has(d.file),
						`${d.kind} used a module path as its file: ${d.file}`
					);
				}
			}
		);
	});

	test('disk discovery reports the same base', async () => {
		// `analyzeFromFiles` is the only path where discovery picks the file
		// set, and it normalizes discovery diagnostics on a third code path of
		// its own (`analyze.ts`) rather than through `analyzeCore`.
		await withTestProject(
			{
				'src/lib/Legacy.svelte': `<script lang="ts">\n\texport let prop1: string;\n</script>\n`,
				'src/lib/nodocs.ts': NODOCS_MODULE_COMMENT_TS,
				'src/lib/a.ts': `export const dup = 1;`,
				'src/lib/b.ts': `export const dup = 2;`
			},
			async (projectRoot) => {
				const { modules, diagnostics } = await analyzeFromFiles({ projectRoot, discovery: 'glob' });
				assert.isAtLeast(diagnostics.length, 3);
				const modulePaths = new Set(modules.map((m) => m.path));
				for (const d of diagnostics) {
					assert.ok(existsSync(join(projectRoot, d.file)), `${d.kind}: ${d.file}`);
					assert.isFalse(modulePaths.has(d.file), `${d.kind} used a module path: ${d.file}`);
				}
			}
		);
	});
});

describe('producers agree on one base', () => {
	test('the same misplaced_tag cause reports alike from .svelte and .ts', async () => {
		// The sharpest form of the bug: one diagnostic kind, one cause, two
		// bases decided by file type. The Svelte path emitted `Nodocs.svelte`
		// while the TypeScript path emitted `src/lib/nodocs.ts`.
		const { diagnostics } = await analyzeTestProject({
			'src/lib/Nodocs.svelte': NODOCS_MODULE_COMMENT_SVELTE,
			'src/lib/nodocs.ts': NODOCS_MODULE_COMMENT_TS
		});
		assert.deepStrictEqual(
			byKind(diagnostics, 'misplaced_tag')
				.map((d) => d.file)
				.sort(),
			['src/lib/Nodocs.svelte', 'src/lib/nodocs.ts']
		);
	});

	test('a Svelte-layer diagnostic matches an extractor diagnostic on the same file', async () => {
		// `duplicate_comment` comes from `analyzeSvelteModule`, `unknown_param`
		// from the extractors via `getNodeLocation` — one file, so one `file`.
		const { diagnostics } = await analyzeTestProject({
			'src/lib/Widget.svelte': `<!-- @component HTML doc. -->
<script module lang="ts">
	/**
	 * Description.
	 *
	 * @param nope - no such parameter
	 */
	export const fn = (a: string): string => a;
</script>
<script lang="ts">
	/** In-script doc. */
	let {a}: {a: string} = $props();
</script>
`
		});
		const files = new Set(diagnostics.map((d) => d.file));
		assert.deepStrictEqual([...files], ['src/lib/Widget.svelte']);
		assert.strictEqual(byKind(diagnostics, 'duplicate_comment').length, 1);
		assert.strictEqual(byKind(diagnostics, 'unknown_param').length, 1);
	});

	test('legacy_props reports project-root-relative', async () => {
		const { diagnostics } = await analyzeTestProject({
			'src/lib/Legacy.svelte': `<script lang="ts">\n\texport let prop1: string;\n</script>\n`
		});
		const [legacy] = byKind(diagnostics, 'legacy_props');
		assert.ok(legacy);
		assert.strictEqual(legacy.file, 'src/lib/Legacy.svelte');
	});

	test('duplicate_comment reports project-root-relative', async () => {
		const { diagnostics } = await analyzeTestProject({
			'src/lib/Widget.svelte': DUPLICATE_COMMENT_COMPONENT
		});
		const [duplicate] = byKind(diagnostics, 'duplicate_comment');
		assert.ok(duplicate);
		assert.strictEqual(duplicate.file, 'src/lib/Widget.svelte');
	});

	test('duplicate_declaration keeps module paths in `modules` and the message', async () => {
		// The two bases coexist inside one record by design: `file` is a file
		// path, `modules` names modules.
		const { diagnostics } = await analyzeTestProject({
			'src/lib/a.ts': `export const dup = 1;`,
			'src/lib/b.ts': `export const dup = 2;`
		});
		const [duplicate] = byKind(diagnostics, 'duplicate_declaration');
		assert.ok(duplicate);
		assert.strictEqual(duplicate.file, 'src/lib/a.ts');
		assert.deepStrictEqual(duplicate.modules, ['a.ts', 'b.ts']);
		assert.include(duplicate.message, 'a.ts, b.ts');
	});
});

describe('the base does not track sourceRoot', () => {
	test('a wider sourceRoot shifts module paths but not diagnostic files', async () => {
		// `sourcePaths: ['src']` makes `sourceRoot` `src`, so module paths gain
		// the `lib/` segment. Diagnostics must not move with them — this is the
		// divergence the old behavior encoded, and it is invisible whenever
		// `sourceRoot` happens to be empty.
		await withTestProject(
			{
				'src/lib/Legacy.svelte': `<script lang="ts">\n\texport let prop1: string;\n</script>\n`,
				'src/lib/nodocs.ts': NODOCS_MODULE_COMMENT_TS
			},
			async (projectRoot) => {
				const { modules, diagnostics } = await analyze({
					sourceFiles: [
						{
							id: join(projectRoot, 'src/lib/Legacy.svelte'),
							content: `<script lang="ts">\n\texport let prop1: string;\n</script>\n`
						},
						{ id: join(projectRoot, 'src/lib/nodocs.ts'), content: NODOCS_MODULE_COMMENT_TS }
					],
					sourceOptions: createSourceOptions(projectRoot, { sourcePaths: ['src'] })
				});

				// module paths took the wider root
				assert.deepStrictEqual(modules.map((m) => m.path).sort(), [
					'lib/Legacy.svelte',
					'lib/nodocs.ts'
				]);
				// diagnostics did not
				assert.deepStrictEqual(diagnostics.map((d) => d.file).sort(), [
					'src/lib/Legacy.svelte',
					'src/lib/nodocs.ts'
				]);
				for (const d of diagnostics) {
					assert.ok(existsSync(join(projectRoot, d.file)), `"${d.file}" does not resolve`);
				}
			}
		);
	});
});

describe('module_skipped, the sites no pipeline test reaches', () => {
	// All four are unreachable through a session: `isSource` drops an
	// analyzer-less file before `query()` sees it, and the language service
	// pushes every owned TS file into the program. `analyzeCore` takes the
	// inputs directly and still runs `finalizeDiagnostics`, so these assert the
	// published values.
	test('every reason reports project-root-relative, message included', () => {
		const root = process.cwd();
		const ghostSvelteId = `${root}/src/lib/Ghost.svelte`;
		const svelteVirtualFiles = new Map<string, SvelteVirtualFile>([
			[
				ghostSvelteId,
				{
					// deliberately absent from the program, so the lookup misses
					virtualPath: ghostSvelteId + SVELTE_VIRTUAL_SUFFIX,
					content: '',
					sourceMap: null,
					scriptKind: ts.ScriptKind.TS
				}
			]
		]);

		const { diagnostics } = analyzeCore({
			sourceFiles: [
				{ id: `${root}/src/lib/notes.md`, content: '' },
				{ id: `${root}/src/lib/__ghost__.ts`, content: '' },
				{ id: `${root}/src/lib/Bare.svelte`, content: '' },
				{ id: ghostSvelteId, content: '' }
			],
			sourceOptions: testSourceOptions(),
			program: createCachedAnalysisProgram(),
			svelteVirtualFiles
		});

		assert.deepStrictEqual(
			byKind(diagnostics, 'module_skipped')
				.map((d) => `${d.reason} ${d.file}`)
				.sort(),
			[
				'no_analyzer src/lib/notes.md',
				'not_in_program src/lib/Ghost.svelte',
				'not_in_program src/lib/__ghost__.ts',
				'requires_program src/lib/Bare.svelte'
			]
		);
	});

	test('the messages carry no absolute path', () => {
		// These three interpolate the absolute id so `file` and the message can't
		// name the file differently — which puts the whole weight on
		// `normalizeDiagnosticPaths`'s textual message scrub. Assert the scrubbed
		// text exactly, since nothing else in the suite reaches these branches.
		const root = process.cwd();
		const ghostSvelteId = `${root}/src/lib/Ghost.svelte`;
		const { diagnostics } = analyzeCore({
			sourceFiles: [
				{ id: `${root}/src/lib/notes.md`, content: '' },
				{ id: `${root}/src/lib/__ghost__.ts`, content: '' },
				{ id: ghostSvelteId, content: '' }
			],
			sourceOptions: testSourceOptions(),
			program: createCachedAnalysisProgram(),
			svelteVirtualFiles: new Map<string, SvelteVirtualFile>([
				[
					ghostSvelteId,
					{
						virtualPath: ghostSvelteId + SVELTE_VIRTUAL_SUFFIX,
						content: '',
						sourceMap: null,
						scriptKind: ts.ScriptKind.TS
					}
				]
			])
		});

		assert.deepStrictEqual(
			byKind(diagnostics, 'module_skipped')
				.map((d) => d.message)
				.sort(),
			[
				'Could not get source file from program: src/lib/__ghost__.ts',
				'No analyzer for file type: src/lib/notes.md',
				'Virtual file not found in program: src/lib/Ghost.svelte'
			]
		);
		for (const d of diagnostics) {
			assert.notInclude(d.message, root, `${d.kind} leaked the project root`);
		}
	});
});
