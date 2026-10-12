/**
 * Tests for `export * from` a project module that emits no module of its own:
 * gated (`internal/`), or source-scope but outside the analyzed inputs.
 *
 * `starExports` can only point at a module the output contains. For any other
 * target the star is read as the named same-name re-exports it stands for, so
 * each projected binding goes through the ordinary re-export arms: a
 * synthesized alias when its canonical emits nothing, a `reExports` link when
 * it does.
 *
 * Locked contracts: ES star semantics (no `default`, local shadowing,
 * ambiguity excluded); the target is absent from `starExports`; bindings sit
 * at the star statement's line; chains through further non-emitted modules,
 * renames, namespaces and type-only forms; a name an emitted star also
 * provides stays with that star; statement-level `@nodocs` (suppressing its
 * own bindings while still counting toward ambiguity); no duplicate
 * diagnostics across modules; emitted star targets are untouched.
 */

import { join } from 'node:path';
import { test, assert, describe } from 'vitest';

import { analyze } from '#lib/analyze.ts';
import type { AnalyzeResultJson } from '#lib/analyze-core.ts';
import { createSourceOptions } from '#lib/source-config.ts';
import { resolveExportSurface } from '#lib/postprocess.ts';
import type { ModuleJson } from '#lib/types.ts';

import { withTestProject } from './test-helpers.ts';

/** Run `analyze()` over `files` written to a temp project, with only `inputPaths` as inputs. */
const analyzeProject = async (
	files: Record<string, string>,
	inputPaths: Array<string>,
	onDuplicates?: 'diagnostic'
): Promise<AnalyzeResultJson> =>
	withTestProject(files, (projectRoot) =>
		analyze({
			sourceFiles: inputPaths.map((path) => ({
				id: join(projectRoot, path),
				content: files[path]!
			})),
			sourceOptions: createSourceOptions(projectRoot),
			onDuplicates
		})
	);

const moduleAt = (result: AnalyzeResultJson, path: string): ModuleJson => {
	const mod = result.modules.find((m) => m.path === path);
	assert.ok(mod, `${path} is in the output`);
	return mod;
};

/** `[name, kind, aliasOf module, aliasOf name]` per declaration. */
const shapes = (mod: ModuleJson): Array<Array<string | undefined>> =>
	mod.declarations.map((d) => [d.name, d.kind, d.aliasOf?.module, d.aliasOf?.name]);

describe('star exports over modules that emit nothing', () => {
	test('a star over a non-input module documents its bindings where it is written', async () => {
		const result = await analyzeProject(
			{
				'src/lib/a.ts': `/** Doc */\nexport const x = 1;\nexport type T = 1 | 2;\nexport const fn = (v: T): T => v;\nexport default 5;`,
				'src/lib/index.ts': `// leading line\nexport * from './a.ts';`
			},
			['src/lib/index.ts']
		);
		assert.deepStrictEqual(result.diagnostics, []);
		const index = moduleAt(result, 'index.ts');
		assert.deepStrictEqual(index.starExports, []);
		assert.deepStrictEqual(index.reExports, []);
		// `default` never projects through a star
		assert.deepStrictEqual(shapes(index), [
			['x', 'variable', 'a.ts', 'x'],
			['T', 'type', 'a.ts', 'T'],
			['fn', 'function', 'a.ts', 'fn']
		]);
		const x = index.declarations[0]!;
		assert.strictEqual(x.docComment, 'Doc');
		// positioned at the star statement, not in the foreign file
		assert.deepStrictEqual(
			index.declarations.map((d) => d.sourceLine),
			[2, 2, 2]
		);

		const surface = resolveExportSurface(result.modules, 'index.ts');
		assert.ok(surface);
		assert.deepStrictEqual(surface.unresolvedStarExports, []);
		assert.deepStrictEqual(
			surface.entries.map((e) => e.name),
			['fn', 'T', 'x']
		);
	});

	test('a star over an emitted module is still a starExports entry', async () => {
		const files = {
			'src/lib/a.ts': `export const x = 1;`,
			'src/lib/index.ts': `export * from './a.ts';`
		};
		const result = await analyzeProject(files, Object.keys(files));
		const index = moduleAt(result, 'index.ts');
		assert.deepStrictEqual(index.starExports, ['a.ts']);
		assert.deepStrictEqual(index.declarations, []);
	});

	test('a local export shadows, and a name two stars disagree on is excluded', async () => {
		const result = await analyzeProject(
			{
				'src/lib/a.ts': `export const shadow = 'a';\nexport const dup = 'a';\nexport const onlyA = 1;`,
				'src/lib/b.ts': `export const dup = 'b';\nexport const onlyB = 2;`,
				'src/lib/index.ts': `export * from './a.ts';\nexport * from './b.ts';\nexport const shadow = 'local';`
			},
			['src/lib/index.ts']
		);
		const index = moduleAt(result, 'index.ts');
		assert.deepStrictEqual(shapes(index), [
			['shadow', 'variable', undefined, undefined],
			['onlyA', 'variable', 'a.ts', 'onlyA'],
			['onlyB', 'variable', 'b.ts', 'onlyB']
		]);
		assert.strictEqual(index.declarations[0]!.typeSignature, '"local"');
	});

	test('two stars that reach the same binding are not ambiguous', async () => {
		const result = await analyzeProject(
			{
				'src/lib/a.ts': `export const x = 1;`,
				'src/lib/b.ts': `export { x } from './a.ts';`,
				'src/lib/index.ts': `export * from './a.ts';\nexport * from './b.ts';`
			},
			['src/lib/index.ts']
		);
		assert.deepStrictEqual(shapes(moduleAt(result, 'index.ts')), [['x', 'variable', 'a.ts', 'x']]);
	});

	test('chains: a star through further non-input modules, renames, and type-only forms', async () => {
		const result = await analyzeProject(
			{
				'src/lib/deep.ts': `export const deep = 1;\nexport type D = string;`,
				'src/lib/mid.ts': `export * from './deep.ts';\nexport { deep as renamed } from './deep.ts';\nexport type { D as U } from './deep.ts';`,
				'src/lib/index.ts': `export * from './mid.ts';`
			},
			['src/lib/index.ts']
		);
		assert.deepStrictEqual(result.diagnostics, []);
		// export-table order: the intermediate module's own specifiers, then
		// what its star projects
		assert.deepStrictEqual(shapes(moduleAt(result, 'index.ts')), [
			['renamed', 'variable', 'deep.ts', 'deep'],
			['U', 'type', 'deep.ts', 'D'],
			['deep', 'variable', 'deep.ts', 'deep'],
			['D', 'type', 'deep.ts', 'D']
		]);
	});

	test('a binding whose canonical does emit becomes a link to it', async () => {
		const files = {
			'src/lib/pub.ts': `export const p = 1;\nexport const q = 2;`,
			'src/lib/mid.ts': `export { p } from './pub.ts';\nexport { q as r } from './pub.ts';`,
			'src/lib/index.ts': `export * from './mid.ts';`
		};
		const result = await analyzeProject(files, ['src/lib/index.ts', 'src/lib/pub.ts']);
		const index = moduleAt(result, 'index.ts');
		// the same-name binding links to the emitted canonical; the rename is a
		// name the canonical doesn't have, so it is declared here
		assert.deepStrictEqual(index.reExports, [
			{ name: 'p', module: 'pub.ts', typeOnly: false, sourceLine: 1 }
		]);
		assert.deepStrictEqual(shapes(index), [['r', 'variable', 'pub.ts', 'q']]);
		const p = moduleAt(result, 'pub.ts').declarations.find((d) => d.name === 'p');
		assert.deepStrictEqual(p?.alsoExportedFrom, ['index.ts']);
	});

	test('a name an emitted star also provides stays with that star', async () => {
		const files = {
			'src/lib/pub.ts': `export const p = 1;`,
			'src/lib/mid.ts': `export { p } from './pub.ts';\nexport const m = 2;`,
			'src/lib/index.ts': `export * from './pub.ts';\nexport * from './mid.ts';`
		};
		const result = await analyzeProject(files, ['src/lib/index.ts', 'src/lib/pub.ts']);
		const index = moduleAt(result, 'index.ts');
		assert.deepStrictEqual(index.starExports, ['pub.ts']);
		assert.deepStrictEqual(index.reExports, []);
		assert.deepStrictEqual(shapes(index), [['m', 'variable', 'mid.ts', 'm']]);
	});

	test('a namespace binding projected through the star documents as a namespace', async () => {
		const result = await analyzeProject(
			{
				'src/lib/a.ts': `export const x = 1;`,
				'src/lib/mid.ts': `export * as ns from './a.ts';`,
				'src/lib/index.ts': `export * from './mid.ts';`
			},
			['src/lib/index.ts']
		);
		const ns = moduleAt(result, 'index.ts').declarations[0];
		assert(ns?.kind === 'namespace');
		assert.strictEqual(ns.name, 'ns');
		assert.strictEqual(ns.module, 'a.ts');
		assert.deepStrictEqual(ns.aliasOf, { module: 'mid.ts', name: 'ns' });
		// no absolute path leaks through a `typeof import(...)` signature
		assert.isUndefined(ns.typeSignature);
	});

	test('`export type *` marks the links it produces type-only', async () => {
		const files = {
			'src/lib/pub.ts': `export type P = 1;`,
			'src/lib/mid.ts': `export type { P } from './pub.ts';`,
			'src/lib/index.ts': `export type * from './mid.ts';`
		};
		const result = await analyzeProject(files, ['src/lib/index.ts', 'src/lib/pub.ts']);
		assert.deepStrictEqual(moduleAt(result, 'index.ts').reExports, [
			{ name: 'P', module: 'pub.ts', typeOnly: true, sourceLine: 1 }
		]);
	});

	test('a @nodocs star still makes a name ambiguous, and its binding never leaks', async () => {
		const result = await analyzeProject(
			{
				'src/lib/a.ts': `export const amb = 'a';\nexport const onlyA = 1;`,
				'src/lib/b.ts': `export const amb = 'b';\nexport const onlyB = 2;`,
				// TypeScript's export table keeps the first star's `amb`: the
				// suppressed one's
				'src/lib/index.ts': `/** @nodocs */\nexport * from './a.ts';\nexport * from './b.ts';`
			},
			['src/lib/index.ts']
		);
		assert.deepStrictEqual(shapes(moduleAt(result, 'index.ts')), [
			['onlyB', 'variable', 'b.ts', 'onlyB']
		]);
	});

	test('statement-level @nodocs suppresses the whole star', async () => {
		const result = await analyzeProject(
			{
				'src/lib/a.ts': `export const x = 1;`,
				'src/lib/index.ts': `/** @nodocs */\nexport * from './a.ts';`
			},
			['src/lib/index.ts']
		);
		const index = moduleAt(result, 'index.ts');
		assert.deepStrictEqual(index.declarations, []);
		assert.deepStrictEqual(index.starExports, []);
	});

	test('two modules starring the same non-input module are not duplicates', async () => {
		const files = {
			'src/lib/a.ts': `export const x = 1;`,
			'src/lib/one.ts': `export * from './a.ts';`,
			'src/lib/two.ts': `export * from './a.ts';`
		};
		const result = await analyzeProject(files, ['src/lib/one.ts', 'src/lib/two.ts'], 'diagnostic');
		assert.deepStrictEqual(result.diagnostics, []);
		assert.deepStrictEqual(shapes(moduleAt(result, 'one.ts')), [['x', 'variable', 'a.ts', 'x']]);
		assert.deepStrictEqual(shapes(moduleAt(result, 'two.ts')), [['x', 'variable', 'a.ts', 'x']]);
	});

	test('a star written in a component module script is positioned in the .svelte source', async () => {
		const files = {
			'src/lib/internal/helper.ts': `export const s = 1;`,
			// the module script comes second, so svelte2tsx hoists it and the
			// virtual's line for the star differs from the source's
			'src/lib/Comp.svelte': `<script lang="ts">\n\tlet { a }: { a: string } = $props();\n\tconst b = a;\n\tconst c = b;\n</script>\n\n{c}\n\n<script lang="ts" module>\n\t// a comment\n\texport * from './internal/helper.ts';\n</script>`
		};
		const result = await analyzeProject(files, Object.keys(files));
		assert.deepStrictEqual(result.diagnostics, []);
		const s = moduleAt(result, 'Comp.svelte').declarations.find((d) => d.name === 's');
		assert.ok(s);
		assert.deepStrictEqual(s.aliasOf, { module: 'internal/helper.ts', name: 's' });
		// the star's line in the original file, not in the svelte2tsx virtual
		assert.strictEqual(s.sourceLine, 11);
	});

	test('a star over a non-input component projects its module exports, not the component', async () => {
		const files = {
			'src/lib/Widget.svelte': `<script lang="ts" module>\n\texport type A = 'a' | 'b';\n\texport const fn = (x: A): A => x;\n</script>\n\n<script lang="ts">\n\tlet { a }: { a: A } = $props();\n</script>\n\n{a}`,
			'src/lib/index.ts': `export * from './Widget.svelte';`
		};
		// the component is supplied as context: `analyze()` reads nothing itself
		const result = await withTestProject(files, async (projectRoot) => {
			const { createAnalysisSession } = await import('#lib/session.ts');
			const session = createAnalysisSession({ sourceOptions: createSourceOptions(projectRoot) });
			try {
				await session.setFile({
					id: join(projectRoot, 'src/lib/index.ts'),
					content: files['src/lib/index.ts']
				});
				return session.query();
			} finally {
				session.dispose();
			}
		});
		assert.deepStrictEqual(result.diagnostics, []);
		// the component is the default export, which a star never projects, and
		// no svelte2tsx-generated name leaks
		assert.deepStrictEqual(shapes(moduleAt(result, 'index.ts')), [
			['A', 'type', 'Widget.svelte', 'A'],
			['fn', 'function', 'Widget.svelte', 'fn']
		]);
	});
});
