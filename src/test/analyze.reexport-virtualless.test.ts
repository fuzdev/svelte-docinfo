/**
 * Tests for re-exports of a `.svelte` file the program has no svelte2tsx
 * virtual for — its transform failed, or it was never supplied.
 *
 * With no virtual, the checker resolves such a specifier to nothing, or to
 * the `svelte` package's ambient `declare module '*.svelte'` once any file in
 * the program imports `svelte` (svelte2tsx's shims do, as soon as some other
 * component has a virtual). The reading is by path instead
 * (`ExtractContext.svelteFileStatus`), so an unrelated valid component in the
 * program changes nothing.
 *
 * Locked contracts: every form gives identical output with and without an
 * unrelated valid component; the default documents as a `partial` component
 * (export-from, `export {default}`, and import-then-export alike); a
 * namespace documents as a `partial` namespace; the default slot keeps the
 * valid path's naming (`default` except for `export {default} from`); a
 * chain through other modules takes the valid chain's shape (an edge to an
 * emitting same-name hop, else a synthesized alias); a star over the failed
 * component's placeholder is a `starExports` entry that
 * `resolveExportSurface` reports unresolved, never an `externalStarExports`
 * entry; a star over one that emits nothing (gated, never supplied) is
 * dropped; a missing file documents nothing; in-memory content counts as
 * existing, also under `analyzeCore`'s default check; a `<script module>`
 * name stays a bare `variable`.
 */

import { join } from 'node:path';
import { test, assert, describe } from 'vitest';

import { analyze } from '#lib/analyze.ts';
import { analyzeCore, type AnalyzeResultJson } from '#lib/analyze-core.ts';
import { createAnalysisProgram } from '#lib/typescript-program.ts';
import type { ModuleJson } from '#lib/types.ts';
import { createSourceOptions } from '#lib/source-config.ts';
import { resolveExportSurface } from '#lib/postprocess.ts';

import { withTestProject } from './test-helpers.ts';

// an unterminated `<script>` makes svelte2tsx throw
const BAD = `<script lang="ts">const x =`;
const GOOD = `<script lang="ts">\n\tlet { a }: { a: string } = $props();\n</script>\n{a}`;

/** Run `analyze()` over `files` written to a temp project, inputs = `inputPaths` (default: all). */
const analyzeProject = async (
	files: Record<string, string>,
	inputPaths?: Array<string>
): Promise<AnalyzeResultJson> =>
	withTestProject(files, (projectRoot) =>
		analyze({
			sourceFiles: (inputPaths ?? Object.keys(files)).map((path) => ({
				id: join(projectRoot, path),
				content: files[path]!
			})),
			sourceOptions: createSourceOptions(projectRoot)
		})
	);

/**
 * Analyze `index` beside a failed `Bad.svelte` (and a failed
 * `internal/Bad.svelte`), once alone and once with an unrelated valid
 * component, assert the two give identical `index.ts` output, and return it
 * with the alone run's result.
 */
const analyzeBothWays = async (
	index: string,
	extraFiles: Record<string, string> = {}
): Promise<{ index: ModuleJson; result: AnalyzeResultJson }> => {
	const files: Record<string, string> = {
		'src/lib/Bad.svelte': BAD,
		'src/lib/internal/Bad.svelte': BAD,
		'src/lib/index.ts': index,
		...extraFiles
	};
	const alone = await analyzeProject(files);
	const withGood = await analyzeProject({ ...files, 'src/lib/Good.svelte': GOOD });
	// every module the two share: all but `Good.svelte`
	assert.deepStrictEqual(
		withGood.modules.filter((m) => m.path !== 'Good.svelte'),
		alone.modules
	);
	const indexAlone = alone.modules.find((m) => m.path === 'index.ts');
	assert.ok(indexAlone);
	return { index: indexAlone, result: alone };
};

/** The declaration facts these tests lock. */
const summarize = (mod: ModuleJson) =>
	mod.declarations.map((d) => ({
		name: d.name,
		kind: d.kind,
		partial: d.partial,
		...(d.aliasOf ? { aliasOf: d.aliasOf } : {}),
		...(d.kind === 'namespace' ? { module: d.module } : {})
	}));

/** Assert `mod` records nothing in the edge and external views. */
const assertNoEdges = (mod: ModuleJson): void => {
	assert.deepStrictEqual(mod.reExports, []);
	assert.deepStrictEqual(mod.externalReExports, []);
	assert.deepStrictEqual(mod.externalStarExports, []);
};

describe('re-exports of a component that failed to transform', () => {
	test('a renamed default documents as a partial component', async () => {
		const { index } = await analyzeBothWays(
			`/** The bad one. */\nexport { default as BadNamed } from './Bad.svelte';`
		);
		assert.deepStrictEqual(summarize(index), [
			{
				name: 'BadNamed',
				kind: 'component',
				partial: true,
				aliasOf: { module: 'Bad.svelte', name: 'Bad' }
			}
		]);
		assert.strictEqual(index.declarations[0]!.docComment, 'The bad one.');
		assert.strictEqual(index.declarations[0]!.sourceLine, 2);
		assertNoEdges(index);
	});

	test('`export {default}` documents under the component name', async () => {
		const { index } = await analyzeBothWays(`export { default } from './Bad.svelte';`);
		assert.deepStrictEqual(summarize(index), [
			{
				name: 'Bad',
				kind: 'component',
				partial: true,
				aliasOf: { module: 'Bad.svelte', name: 'Bad' }
			}
		]);
		assertNoEdges(index);
	});

	test('an import-then-export documents like the export-from form', async () => {
		const { index } = await analyzeBothWays(
			`import Bad from './Bad.svelte';\nimport { default as Renamed } from './Bad.svelte';\nexport { Bad, Renamed };`
		);
		assert.deepStrictEqual(summarize(index), [
			{
				name: 'Bad',
				kind: 'component',
				partial: true,
				aliasOf: { module: 'Bad.svelte', name: 'Bad' }
			},
			{
				name: 'Renamed',
				kind: 'component',
				partial: true,
				aliasOf: { module: 'Bad.svelte', name: 'Bad' }
			}
		]);
		// positioned at the export specifier
		assert.deepStrictEqual(
			index.declarations.map((d) => d.sourceLine),
			[3, 3]
		);
		assertNoEdges(index);
	});

	test('`export default X` over an import documents as a partial `default`', async () => {
		const { index } = await analyzeBothWays(
			`import Bad from './Bad.svelte';\n/** The bad one. */\nexport default Bad;`
		);
		assert.deepStrictEqual(summarize(index), [
			{
				name: 'default',
				kind: 'component',
				partial: true,
				aliasOf: { module: 'Bad.svelte', name: 'Bad' }
			}
		]);
		assert.strictEqual(index.declarations[0]!.docComment, 'The bad one.');
		assertNoEdges(index);
	});

	test('renaming into the default slot keeps the name `default`', async () => {
		const { index } = await analyzeBothWays(
			`import Bad from './Bad.svelte';\nexport { Bad as default };`
		);
		assert.deepStrictEqual(summarize(index), [
			{
				name: 'default',
				kind: 'component',
				partial: true,
				aliasOf: { module: 'Bad.svelte', name: 'Bad' }
			}
		]);
		assertNoEdges(index);
	});

	test('a chain through an emitting module links same-name and aliases renames', async () => {
		const { index, result } = await analyzeBothWays(
			`export { Bad } from './c.ts';\nexport { Bad as B2 } from './c.ts';\nexport { ns } from './c.ts';\nexport { ns as ns2 } from './c.ts';`,
			{
				'src/lib/c.ts': `import Bad from './Bad.svelte';\nexport { Bad };\nexport * as ns from './Bad.svelte';`
			}
		);
		const c = result.modules.find((m) => m.path === 'c.ts');
		assert.ok(c);
		assert.deepStrictEqual(summarize(c), [
			{
				name: 'Bad',
				kind: 'component',
				partial: true,
				aliasOf: { module: 'Bad.svelte', name: 'Bad' }
			},
			{ name: 'ns', kind: 'namespace', partial: true, module: 'Bad.svelte' }
		]);
		assert.deepStrictEqual(
			index.reExports.map((e) => [e.name, e.module]),
			[
				['Bad', 'c.ts'],
				['ns', 'c.ts']
			]
		);
		assert.deepStrictEqual(summarize(index), [
			{
				name: 'B2',
				kind: 'component',
				partial: true,
				aliasOf: { module: 'Bad.svelte', name: 'Bad' }
			},
			{
				name: 'ns2',
				kind: 'namespace',
				partial: true,
				aliasOf: { module: 'c.ts', name: 'ns' },
				module: 'Bad.svelte'
			}
		]);
		// the edge resolves to `c.ts`'s partial component
		assert.deepStrictEqual(c.declarations[0]!.alsoExportedFrom, ['index.ts']);
	});

	test("a chain through a valid component's `<script module>` reaches the failed one", async () => {
		const { index, result } = await analyzeBothWays(
			`export { Inner } from './Wrap.svelte';\nexport { Inner as I2 } from './Wrap.svelte';`,
			{
				'src/lib/Wrap.svelte': `<script module lang="ts">\n\texport { default as Inner } from './Bad.svelte';\n</script>\n<p>wrap</p>`
			}
		);
		const wrap = result.modules.find((m) => m.path === 'Wrap.svelte');
		assert.ok(wrap);
		assert.deepStrictEqual(
			wrap.declarations.map((d) => [d.name, d.kind, d.partial]),
			[
				['Wrap', 'component', false],
				['Inner', 'component', true]
			]
		);
		assert.deepStrictEqual(
			index.reExports.map((e) => [e.name, e.module]),
			[['Inner', 'Wrap.svelte']]
		);
		assert.deepStrictEqual(summarize(index), [
			{
				name: 'I2',
				kind: 'component',
				partial: true,
				aliasOf: { module: 'Bad.svelte', name: 'Bad' }
			}
		]);
	});

	test('a chain through a gated module synthesizes every name', async () => {
		const { index } = await analyzeBothWays(
			`export { Bad } from './internal/c.ts';\nexport { Bad as B2 } from './internal/c.ts';`,
			{ 'src/lib/internal/c.ts': `import Bad from '../Bad.svelte';\nexport { Bad };` }
		);
		assert.deepStrictEqual(summarize(index), [
			{
				name: 'Bad',
				kind: 'component',
				partial: true,
				aliasOf: { module: 'Bad.svelte', name: 'Bad' }
			},
			{
				name: 'B2',
				kind: 'component',
				partial: true,
				aliasOf: { module: 'Bad.svelte', name: 'Bad' }
			}
		]);
		assertNoEdges(index);
	});

	test('a namespace documents as a partial namespace over the placeholder', async () => {
		const { index } = await analyzeBothWays(
			`export * as ns from './Bad.svelte';\nimport * as imported from './Bad.svelte';\nexport { imported };`
		);
		assert.deepStrictEqual(summarize(index), [
			{ name: 'ns', kind: 'namespace', partial: true, module: 'Bad.svelte' },
			{ name: 'imported', kind: 'namespace', partial: true, module: 'Bad.svelte' }
		]);
		assertNoEdges(index);
	});

	test('a star names the placeholder, and the surface reports it unresolved', async () => {
		const { index, result } = await analyzeBothWays(
			`export * from './Bad.svelte';\nexport const y = 1;`
		);
		assert.deepStrictEqual(index.starExports, ['Bad.svelte']);
		assertNoEdges(index);
		const bad = result.modules.find((m) => m.path === 'Bad.svelte');
		assert.ok(bad?.partial);

		const surface = resolveExportSurface(result.modules, 'index.ts');
		assert.ok(surface);
		assert.deepStrictEqual(
			surface.entries.map((e) => e.name),
			['y']
		);
		assert.deepStrictEqual(surface.unresolvedStarExports, ['Bad.svelte']);
		assert.deepStrictEqual(surface.externalStarExports, []);
	});

	test('a gated component: a star drops, a named re-export dangles', async () => {
		const { index } = await analyzeBothWays(
			`export * from './internal/Bad.svelte';\nexport { default as G } from './internal/Bad.svelte';`
		);
		assert.deepStrictEqual(index.starExports, []);
		assert.deepStrictEqual(summarize(index), [
			{
				name: 'G',
				kind: 'component',
				partial: true,
				aliasOf: { module: 'internal/Bad.svelte', name: 'Bad' }
			}
		]);
		assertNoEdges(index);
	});

	test('a `<script module>` name stays a bare variable', async () => {
		const { index } = await analyzeBothWays(`export { foo } from './Bad.svelte';`);
		assert.deepStrictEqual(summarize(index), [{ name: 'foo', kind: 'variable', partial: false }]);
		assertNoEdges(index);
	});
});

describe('re-exports of a missing `.svelte` file', () => {
	test('every form documents nothing', async () => {
		const { index } = await analyzeBothWays(
			[
				`export * from './Missing.svelte';`,
				`export { default as M } from './Missing.svelte';`,
				`export * as ns from './Missing.svelte';`,
				`import Imported from './Missing.svelte';`,
				`export { Imported };`,
				`export const y = 1;`
			].join('\n')
		);
		assert.deepStrictEqual(
			index.declarations.map((d) => d.name),
			['y']
		);
		assert.deepStrictEqual(index.starExports, []);
		assertNoEdges(index);
	});
});

describe('re-exports of a component never supplied', () => {
	test('a named re-export is partial, a star drops', async () => {
		const files: Record<string, string> = {
			'src/lib/Unsupplied.svelte': GOOD,
			'src/lib/Good.svelte': GOOD,
			'src/lib/index.ts': `export * from './Unsupplied.svelte';\nexport { default as U } from './Unsupplied.svelte';\nexport { default as G } from './Good.svelte';`
		};
		const result = await analyzeProject(files, ['src/lib/Good.svelte', 'src/lib/index.ts']);
		const index = result.modules.find((m) => m.path === 'index.ts');
		assert.ok(index);
		assert.deepStrictEqual(index.starExports, []);
		assert.deepStrictEqual(summarize(index), [
			{
				name: 'U',
				kind: 'component',
				partial: true,
				aliasOf: { module: 'Unsupplied.svelte', name: 'Unsupplied' }
			},
			{
				name: 'G',
				kind: 'component',
				partial: false,
				aliasOf: { module: 'Good.svelte', name: 'Good' }
			}
		]);
		assertNoEdges(index);
	});
});

describe('in-memory content', () => {
	test('a failed component only in memory still counts as existing', async () => {
		const root = '/svelte-docinfo-virtualless-in-memory';
		const result = await analyze({
			sourceFiles: [
				{ id: `${root}/src/lib/Bad.svelte`, content: BAD },
				{
					id: `${root}/src/lib/index.ts`,
					content: `export * from './Bad.svelte';\nexport { default as BadNamed } from './Bad.svelte';`
				}
			],
			sourceOptions: createSourceOptions(root),
			tsconfig: false
		});
		const index = result.modules.find((m) => m.path === 'index.ts');
		assert.ok(index);
		assert.deepStrictEqual(index.starExports, ['Bad.svelte']);
		assert.deepStrictEqual(summarize(index), [
			{
				name: 'BadNamed',
				kind: 'component',
				partial: true,
				aliasOf: { module: 'Bad.svelte', name: 'Bad' }
			}
		]);
		assertNoEdges(index);
	});

	test("`analyzeCore`'s default existence check sees the files handed in", () => {
		// no `fileExists` and no disk: existence comes from `sourceFiles` alone
		const root = '/svelte-docinfo-virtualless-core';
		const badId = `${root}/src/lib/Bad.svelte`;
		const indexId = `${root}/src/lib/index.ts`;
		const indexContent = `export * from './Bad.svelte';\nexport * from './Missing.svelte';\nexport { default as BadNamed } from './Bad.svelte';\nexport { default as M } from './Missing.svelte';`;
		const program = createAnalysisProgram({
			projectRoot: root,
			tsconfig: false,
			virtualFiles: new Map([[indexId, { content: indexContent }]])
		});
		const result = analyzeCore({
			sourceFiles: [
				{ id: badId, content: BAD },
				{ id: indexId, content: indexContent }
			],
			sourceOptions: createSourceOptions(root),
			program,
			svelteVirtualFiles: new Map(),
			transformFailedIds: new Set([badId])
		});
		const index = result.modules.find((m) => m.path === 'index.ts');
		assert.ok(index);
		assert.deepStrictEqual(index.starExports, ['Bad.svelte']);
		assert.deepStrictEqual(summarize(index), [
			{
				name: 'BadNamed',
				kind: 'component',
				partial: true,
				aliasOf: { module: 'Bad.svelte', name: 'Bad' }
			}
		]);
		assertNoEdges(index);
	});
});
