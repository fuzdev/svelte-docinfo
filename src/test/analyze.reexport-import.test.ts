/**
 * Tests for import-then-export re-exports — `import {foo as bar} from './x';
 * export {bar}` and its default, namespace, type-only, and `export default`
 * kin — over a target that emits a module.
 *
 * An import binding is a local name, not an export hop: rename detection and
 * the same-name canonical walk step through it to the binding the target
 * exports, so each form documents like the export-from statement it
 * stands for.
 *
 * Locked contract: every form gives the identical envelope (declarations,
 * edges, `alsoExportedFrom`, diagnostics) as its export-from twin, written
 * with its specifier on the same line so `sourceLine` matches too — the
 * synthesized alias and the `reExports` edge both sit at the export
 * specifier (or the `export default` statement), never at the import. Chains
 * through an import-then-export module link to it only when it declares the
 * name, so no edge dangles.
 */

import { join } from 'node:path';
import { test, assert, describe } from 'vitest';

import { analyze } from '#lib/analyze.ts';
import type { AnalyzeResultJson } from '#lib/analyze-core.ts';
import { createSourceOptions } from '#lib/source-config.ts';
import { resolveExportSurface } from '#lib/postprocess.ts';

import { withTestProject } from './test-helpers.ts';

const BASE_FILES: Record<string, string> = {
	'src/lib/x.ts': `/** Foo doc. */\nexport const foo = 1;\n/** T doc. */\nexport type T = { a: string };\n/** The g default. */\nexport default function g(): void {}\n`,
	'src/lib/Good.svelte': `<script lang="ts">\n\t/** Good docs. */\n\tlet { a }: { a: string } = $props();\n</script>\n{a}`,
	'src/lib/internal/y.ts': `/** Y foo. */\nexport const foo = 2;\n`
};

/** Run `analyze()` over `BASE_FILES` plus `files` written to a temp project. */
const analyzeProject = async (files: Record<string, string>): Promise<AnalyzeResultJson> => {
	const all = { ...BASE_FILES, ...files };
	return withTestProject(all, (projectRoot) =>
		analyze({
			sourceFiles: Object.entries(all).map(([path, content]) => ({
				id: join(projectRoot, path),
				content
			})),
			sourceOptions: createSourceOptions(projectRoot)
		})
	);
};

/** Assert every `reExports` edge names a declaration its target module has. */
const assertNoDanglingEdges = (result: AnalyzeResultJson): void => {
	for (const mod of result.modules) {
		for (const edge of mod.reExports) {
			const target = result.modules.find((m) => m.path === edge.module);
			assert.ok(target, `${mod.path}: edge to missing module ${edge.module}`);
			assert.ok(
				target.declarations.some((d) => d.name === edge.name),
				`${mod.path}: edge ${edge.name} dangles in ${edge.module}`
			);
		}
	}
};

/**
 * Analyze the import-then-export form and its export-from twin as `index.ts`
 * (beside `extra`), assert identical envelopes, and return the import form's.
 */
const assertLikeExportFrom = async (
	importForm: string,
	exportFromForm: string,
	extra: Record<string, string> = {}
): Promise<AnalyzeResultJson> => {
	const imported = await analyzeProject({ ...extra, 'src/lib/index.ts': importForm });
	const exportFrom = await analyzeProject({ ...extra, 'src/lib/index.ts': exportFromForm });
	assert.deepStrictEqual(imported, exportFrom);
	assertNoDanglingEdges(imported);
	return imported;
};

const indexOf = (result: AnalyzeResultJson) => {
	const index = result.modules.find((m) => m.path === 'index.ts');
	assert.ok(index);
	return index;
};

const declarationOf = (result: AnalyzeResultJson, path: string, name: string) => {
	const decl = result.modules
		.find((m) => m.path === path)
		?.declarations.find((d) => d.name === name);
	assert.ok(decl, `${path}: no declaration ${name}`);
	return decl;
};

describe('import-then-export documents like export-from', () => {
	test('a renamed named import synthesizes an alias at the export specifier', async () => {
		const result = await assertLikeExportFrom(
			`import { foo as bar } from './x.ts';\nexport { bar };`,
			`\nexport { foo as bar } from './x.ts';`
		);
		const bar = declarationOf(result, 'index.ts', 'bar');
		assert.strictEqual(bar.kind, 'variable');
		assert.deepStrictEqual(bar.aliasOf, { module: 'x.ts', name: 'foo' });
		assert.strictEqual(bar.docComment, 'Foo doc.');
		assert.strictEqual(bar.sourceLine, 2);
		assert.deepStrictEqual(indexOf(result).reExports, []);
	});

	test('a same-name named import links to the canonical', async () => {
		const result = await assertLikeExportFrom(
			`import { foo } from './x.ts';\nexport { foo };`,
			`\nexport { foo } from './x.ts';`
		);
		assert.deepStrictEqual(indexOf(result).declarations, []);
		assert.deepStrictEqual(indexOf(result).reExports, [
			{ name: 'foo', module: 'x.ts', typeOnly: false, sourceLine: 2 }
		]);
		assert.deepStrictEqual(declarationOf(result, 'x.ts', 'foo').alsoExportedFrom, ['index.ts']);
	});

	test('an import renamed back to the exported name links like a same-name re-export', async () => {
		const result = await assertLikeExportFrom(
			`import { foo as bar } from './x.ts';\nexport { bar as foo };`,
			`\nexport { foo } from './x.ts';`
		);
		assert.deepStrictEqual(
			indexOf(result).reExports.map((e) => [e.name, e.module]),
			[['foo', 'x.ts']]
		);
	});

	test('a default import synthesizes an alias of the default slot', async () => {
		const result = await assertLikeExportFrom(
			`import G2 from './x.ts';\nexport { G2 };`,
			`\nexport { default as G2 } from './x.ts';`
		);
		const g2 = declarationOf(result, 'index.ts', 'G2');
		assert.strictEqual(g2.kind, 'function');
		assert.deepStrictEqual(g2.aliasOf, { module: 'x.ts', name: 'default' });
	});

	test('`export default` over a default import links the default slot', async () => {
		const result = await assertLikeExportFrom(
			`import g from './x.ts';\nexport default g;`,
			`\nexport { default } from './x.ts';`
		);
		assert.deepStrictEqual(
			indexOf(result).reExports.map((e) => [e.name, e.module, e.sourceLine]),
			[['default', 'x.ts', 2]]
		);
	});

	test('`export default` over a named import synthesizes a `default` alias', async () => {
		const result = await assertLikeExportFrom(
			`import { foo } from './x.ts';\n/** The default foo. */\nexport default foo;`,
			`\n/** The default foo. */\nexport { foo as default } from './x.ts';`
		);
		const decl = declarationOf(result, 'index.ts', 'default');
		assert.deepStrictEqual(decl.aliasOf, { module: 'x.ts', name: 'foo' });
		assert.strictEqual(decl.docComment, 'The default foo.');
		assert.strictEqual(decl.sourceLine, 3);
	});

	test('JSDoc on `export default` of a local binding applies like `export {x as default}`', async () => {
		const result = await assertLikeExportFrom(
			`/** X doc. */\nconst x = 1;\n/** Default doc. */\nexport default x;`,
			`/** X doc. */\nconst x = 1;\n/** Default doc. */\nexport { x as default };`
		);
		const decl = declarationOf(result, 'index.ts', 'default');
		assert.strictEqual(decl.docComment, 'Default doc.');
	});

	test('a namespace import documents as a namespace', async () => {
		const result = await assertLikeExportFrom(
			`import * as xs from './x.ts';\nimport * as ys from './x.ts';\nexport { xs, ys as zs };`,
			`\n\nexport * as xs from './x.ts';export * as zs from './x.ts';`
		);
		const index = indexOf(result);
		assert.deepStrictEqual(
			index.declarations.map((d) => [d.name, d.kind, d.kind === 'namespace' && d.module]),
			[
				['xs', 'namespace', 'x.ts'],
				['zs', 'namespace', 'x.ts']
			]
		);
	});

	test('type-only forms carry the export statement’s type-only marker', async () => {
		const result = await assertLikeExportFrom(
			`import type { T as U, T } from './x.ts';\nexport type { U, T };`,
			`\nexport type { T as U, T } from './x.ts';`
		);
		const u = declarationOf(result, 'index.ts', 'U');
		assert.strictEqual(u.kind, 'type');
		assert.deepStrictEqual(u.aliasOf, { module: 'x.ts', name: 'T' });
		assert.deepStrictEqual(indexOf(result).reExports, [
			{ name: 'T', module: 'x.ts', typeOnly: true, sourceLine: 2 }
		]);
	});

	test('JSDoc on the export statement applies, and `@nodocs` suppresses', async () => {
		const result = await assertLikeExportFrom(
			`import { foo as bar, foo as hidden, foo } from './x.ts';\n/** Bar doc. */\nexport { bar };\n/** @nodocs */\nexport { hidden, foo };`,
			`\n/** Bar doc. */\nexport { foo as bar } from './x.ts';\n/** @nodocs */\nexport { foo as hidden, foo } from './x.ts';`
		);
		const index = indexOf(result);
		assert.deepStrictEqual(
			index.declarations.map((d) => [d.name, d.docComment]),
			[['bar', 'Bar doc.']]
		);
		assert.deepStrictEqual(index.reExports, []);
	});

	test('the gated arm is unchanged', async () => {
		const result = await assertLikeExportFrom(
			`import { foo as bar, foo } from './internal/y.ts';\nexport { bar, foo };`,
			`\nexport { foo as bar, foo } from './internal/y.ts';`
		);
		assert.deepStrictEqual(
			indexOf(result).declarations.map((d) => [d.name, d.aliasOf]),
			[
				['bar', { module: 'internal/y.ts', name: 'foo' }],
				['foo', { module: 'internal/y.ts', name: 'foo' }]
			]
		);
	});
});

describe('import-then-export of a Svelte component', { timeout: 15_000 }, () => {
	test('a default import documents as a component alias', async () => {
		const result = await assertLikeExportFrom(
			`import G2 from './Good.svelte';\nimport Good from './Good.svelte';\nexport { G2, Good };`,
			`\n\nexport { default as G2, default as Good } from './Good.svelte';`
		);
		for (const name of ['G2', 'Good']) {
			const decl = declarationOf(result, 'index.ts', name);
			assert.strictEqual(decl.kind, 'component');
			assert.deepStrictEqual(decl.aliasOf, { module: 'Good.svelte', name: 'Good' });
			assert.strictEqual(decl.docComment, 'Good docs.');
			assert.strictEqual(decl.sourceLine, 3);
			assert.ok(decl.kind === 'component' && decl.props.length === 1);
		}
	});

	test('`export default` links the component under its name', async () => {
		const result = await assertLikeExportFrom(
			`import G from './Good.svelte';\nexport default G;`,
			`\nexport { default } from './Good.svelte';`
		);
		const renamedIntoSlot = await analyzeProject({
			'src/lib/index.ts': `import G from './Good.svelte';\nexport { G as default };`
		});
		assert.deepStrictEqual(renamedIntoSlot, result);
		assert.deepStrictEqual(indexOf(result).declarations, []);
		assert.deepStrictEqual(
			indexOf(result).reExports.map((e) => [e.name, e.module, e.sourceLine]),
			[['Good', 'Good.svelte', 2]]
		);
		const surface = resolveExportSurface(result.modules, 'index.ts');
		assert.ok(surface);
		assert.deepStrictEqual(
			surface.entries.map((e) => e.name),
			['Good']
		);
	});

	test('a documented `export default` synthesizes the alias at the statement', async () => {
		const result = await assertLikeExportFrom(
			`import G from './Good.svelte';\n/** The default. */\nexport default G;`,
			`\n/** The default. */\nexport { default } from './Good.svelte';`
		);
		const decl = declarationOf(result, 'index.ts', 'Good');
		assert.strictEqual(decl.kind, 'component');
		assert.strictEqual(decl.docComment, 'The default.');
		assert.strictEqual(decl.sourceLine, 3);
	});
});

describe('chains through an import-then-export module', { timeout: 15_000 }, () => {
	test('a same-name re-export links to the module that declares the name', async () => {
		const c = `import G from './Good.svelte';\nimport { foo as bar, foo } from './x.ts';\nimport * as xs from './x.ts';\nexport { G, bar, foo, xs };`;
		const cFrom = `\n\n\nexport { default as G } from './Good.svelte';export { foo as bar, foo } from './x.ts';export * as xs from './x.ts';`;
		const index = `export { G, bar, foo, xs } from './c.ts';`;
		const result = await analyzeProject({ 'src/lib/c.ts': c, 'src/lib/index.ts': index });
		const fromResult = await analyzeProject({ 'src/lib/c.ts': cFrom, 'src/lib/index.ts': index });
		assert.deepStrictEqual(result, fromResult);
		assertNoDanglingEdges(result);
		assert.deepStrictEqual(
			indexOf(result).reExports.map((e) => [e.name, e.module]),
			[
				['bar', 'c.ts'],
				['foo', 'x.ts'],
				['G', 'c.ts'],
				['xs', 'c.ts']
			]
		);
		assert.deepStrictEqual(declarationOf(result, 'c.ts', 'G').alsoExportedFrom, ['index.ts']);
		assert.deepStrictEqual(declarationOf(result, 'x.ts', 'foo').alsoExportedFrom, [
			'c.ts',
			'index.ts'
		]);
	});

	test('an import renamed back to its exported name links past the module', async () => {
		const index = `export { foo } from './c.ts';`;
		const result = await analyzeProject({
			'src/lib/c.ts': `import { foo as bar } from './x.ts';\nexport { bar as foo };`,
			'src/lib/index.ts': index
		});
		const fromResult = await analyzeProject({
			'src/lib/c.ts': `\nexport { foo } from './x.ts';`,
			'src/lib/index.ts': index
		});
		assert.deepStrictEqual(result, fromResult);
		assertNoDanglingEdges(result);
		assert.deepStrictEqual(
			indexOf(result).reExports.map((e) => [e.name, e.module]),
			[['foo', 'x.ts']]
		);
	});

	test('a renamed re-export of an exported namespace import documents as a namespace', async () => {
		for (const [cExport, cFromExport, name] of [
			['export { xs };', `export * as xs from './x.ts';`, 'xs'],
			['export { xs as zs };', `export * as zs from './x.ts';`, 'zs']
		] as const) {
			for (const index of [
				`\nexport { ${name} as ys } from './c.ts';`,
				`import { ${name} as ys } from './c.ts';\nexport { ys };`
			]) {
				const result = await analyzeProject({
					'src/lib/c.ts': `import * as xs from './x.ts';\n${cExport}`,
					'src/lib/index.ts': index
				});
				const fromResult = await analyzeProject({
					'src/lib/c.ts': `\n${cFromExport}`,
					'src/lib/index.ts': index
				});
				assert.deepStrictEqual(result, fromResult);
				const ys = declarationOf(result, 'index.ts', 'ys');
				assert.strictEqual(ys.kind, 'namespace');
				assert.ok(ys.kind === 'namespace' && ys.module === 'x.ts');
				assert.deepStrictEqual(ys.aliasOf, { module: 'c.ts', name });
			}
		}
	});

	test('a star over a gated module keeps its namespace import’s provenance', async () => {
		const index = `export * from './internal/c.ts';`;
		const result = await analyzeProject({
			'src/lib/internal/c.ts': `import * as xs from '../x.ts';\nexport { xs };`,
			'src/lib/index.ts': index
		});
		const fromResult = await analyzeProject({
			'src/lib/internal/c.ts': `\nexport * as xs from '../x.ts';`,
			'src/lib/index.ts': index
		});
		assert.deepStrictEqual(result, fromResult);
		const xs = declarationOf(result, 'index.ts', 'xs');
		assert.ok(xs.kind === 'namespace' && xs.module === 'x.ts');
		assert.deepStrictEqual(xs.aliasOf, { module: 'internal/c.ts', name: 'xs' });
	});
});
