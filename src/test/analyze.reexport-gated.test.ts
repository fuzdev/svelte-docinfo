/**
 * Tests for re-exports whose canonical module is project-local but gated from
 * output — the `src/lib/internal/` convention's re-export story.
 *
 * The classification axis is externality (`createIsExternalPath`), not
 * `isSource`: a gated in-root canonical is still project-local, so its
 * re-exports must not masquerade as external-package facts. Since the gated
 * module emits nothing, the re-exporting module owns the documentation — a
 * full alias declaration is synthesized (same-name and renamed alike),
 * inheriting the canonical's analyzed shape, with `aliasOf` kept for
 * provenance and canonical-identity dedupe (its `module` references a module
 * absent from output — a documented margin).
 *
 * Locked contracts: synthesis for same-name/renamed/import-then-export
 * forms; no `externalReExports`/`reExports` entries for gated targets; star
 * exports from gated modules land in `starExports` (surfacing as
 * `unresolvedStarExports` at surface resolution); namespace re-exports from
 * gated modules classify as namespaces; two modules re-exporting the same
 * gated symbol dedupe by canonical identity; local JSDoc overrides and
 * `@nodocs` suppresses as everywhere else; genuinely external re-exports
 * still record `externalReExports` with the package specifier.
 */

import { join } from 'node:path';
import { test, assert, describe } from 'vitest';

import { analyze, analyzeFromFiles } from '$lib/analyze.ts';
import type { AnalyzeResultJson } from '$lib/analyze-core.ts';
import { createSourceOptions } from '$lib/source-config.ts';
import { findDuplicates, resolveExportSurface } from '$lib/postprocess.ts';

import { withTestProject } from './test-helpers.ts';

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

describe('re-exports from gated internal modules', () => {
	test('same-name and renamed re-exports synthesize full alias declarations', async () => {
		const result = await analyzeProject({
			'src/lib/internal/helper.ts': `/** The width. */\nexport const x: number = 1;\nexport const z: string = 'z';`,
			'src/lib/api.ts': `export { x } from './internal/helper.ts';\nexport { z as y } from './internal/helper.ts';`
		});
		const api = result.modules.find((m) => m.path === 'api.ts');
		assert.ok(api);

		// Nothing lands in the external or edge views.
		assert.deepStrictEqual(api.externalReExports, []);
		assert.deepStrictEqual(api.reExports, []);

		// Same-name: full re-analysis of the canonical under the public name.
		const x = api.declarations.find((d) => d.name === 'x');
		assert(x?.kind === 'variable');
		assert.strictEqual(x.typeSignature, 'number');
		assert.strictEqual(x.docComment, 'The width.');
		assert.deepStrictEqual(x.aliasOf, { module: 'internal/helper.ts', name: 'x' });

		// Renamed: public name with aliasOf carrying the canonical name.
		const y = api.declarations.find((d) => d.name === 'y');
		assert(y?.kind === 'variable');
		assert.strictEqual(y.typeSignature, 'string');
		assert.deepStrictEqual(y.aliasOf, { module: 'internal/helper.ts', name: 'z' });
	});

	test('import-then-export of a gated symbol synthesizes too', async () => {
		const result = await analyzeProject({
			'src/lib/internal/helper.ts': `export const secret: number = 2;`,
			'src/lib/api.ts': `import { secret } from './internal/helper.ts';\nexport { secret };`
		});
		const api = result.modules.find((m) => m.path === 'api.ts');
		const secret = api?.declarations.find((d) => d.name === 'secret');
		assert(secret?.kind === 'variable');
		assert.strictEqual(secret.typeSignature, 'number');
		assert.deepStrictEqual(secret.aliasOf, { module: 'internal/helper.ts', name: 'secret' });
		assert.deepStrictEqual(api?.externalReExports, []);
	});

	test('a same-name chain through a gated rename hop synthesizes at the public site', async () => {
		// The deep canonical (base.ts) is source, but the deepest *same-named*
		// symbol lives in the gated hop (`export {y as x}`), so a link-only
		// same-name edge has no declaration to land on — the name would vanish.
		// Synthesis fires instead; `aliasOf` points at the deep canonical, a
		// real declaration.
		const result = await analyzeProject({
			'src/lib/base.ts': `/** The width. */\nexport const y: number = 1;`,
			'src/lib/internal/helper.ts': `export { y as x } from '../base.ts';`,
			'src/lib/api.ts': `export { x } from './internal/helper.ts';`
		});
		const api = result.modules.find((m) => m.path === 'api.ts');
		assert.ok(api);
		const x = api.declarations.find((d) => d.name === 'x');
		assert(x?.kind === 'variable');
		assert.strictEqual(x.typeSignature, 'number');
		assert.strictEqual(x.docComment, 'The width.');
		assert.deepStrictEqual(x.aliasOf, { module: 'base.ts', name: 'y' });
		// No edge: the walk canonical is gated, so there is nothing to back-link.
		assert.deepStrictEqual(api.reExports, []);
		assert.deepStrictEqual(api.externalReExports, []);
	});

	test('local JSDoc overrides the canonical docs; @nodocs suppresses', async () => {
		const result = await analyzeProject({
			'src/lib/internal/helper.ts': `/** Canonical docs. */\nexport const a: number = 1;\n/** Hidden. */\nexport const b: number = 2;`,
			'src/lib/api.ts': `/** Local docs win. */\nexport { a } from './internal/helper.ts';\n/** @nodocs */\nexport { b } from './internal/helper.ts';`
		});
		const api = result.modules.find((m) => m.path === 'api.ts');
		const a = api?.declarations.find((d) => d.name === 'a');
		assert(a?.kind === 'variable');
		assert.strictEqual(a.docComment, 'Local docs win.');
		assert.isUndefined(api?.declarations.find((d) => d.name === 'b'));
	});

	test('two modules re-exporting the same gated symbol are one canonical identity', async () => {
		const result = await analyzeProject({
			'src/lib/internal/helper.ts': `export const shared: number = 1;`,
			'src/lib/a.ts': `export { shared } from './internal/helper.ts';`,
			'src/lib/b.ts': `export { shared } from './internal/helper.ts';`
		});
		// Both synthesize, but their aliasOf chains resolve to the same
		// (dangling) canonical key — not a flat-namespace collision.
		assert.strictEqual(findDuplicates(result.modules).size, 0);
		assert.isFalse(result.diagnostics.some((d) => d.kind === 'duplicate_declaration'));
	});

	test('a star export from a gated module lands in starExports, not externalStarExports', async () => {
		const result = await analyzeProject({
			'src/lib/internal/helper.ts': `export const s: number = 1;`,
			'src/lib/api.ts': `export * from './internal/helper.ts';`
		});
		const api = result.modules.find((m) => m.path === 'api.ts');
		assert.ok(api);
		assert.deepStrictEqual(api.starExports, ['internal/helper.ts']);
		assert.deepStrictEqual(api.externalStarExports, []);

		// Surface resolution reports the gated target as unresolved — truthful
		// incompleteness rather than a fabricated external entry.
		const surface = resolveExportSurface(result.modules, 'api.ts');
		assert.ok(surface);
		assert.deepStrictEqual(surface.unresolvedStarExports, ['internal/helper.ts']);
	});

	test('a namespace re-export of a gated module classifies as a namespace', async () => {
		const result = await analyzeProject({
			'src/lib/internal/helper.ts': `export const n: number = 1;`,
			'src/lib/api.ts': `export * as helpers from './internal/helper.ts';`
		});
		const api = result.modules.find((m) => m.path === 'api.ts');
		const helpers = api?.declarations.find((d) => d.name === 'helpers');
		assert(helpers?.kind === 'namespace');
		// The projected module is gated — absent from output, a documented
		// margin — but the binding documents instead of leaking a relative
		// path into externalReExports or `typeof import("/abs/...")` into
		// typeSignature.
		assert.strictEqual(helpers.module, 'internal/helper.ts');
		assert.deepStrictEqual(api?.externalReExports, []);
	});

	test('a gated Svelte component re-export documents with filled props', async () => {
		const files = {
			'src/lib/internal/Widget.svelte': `<script lang="ts">\n\tlet { label }: { label: string } = $props();\n</script>\n<div>{label}</div>`,
			'src/lib/api.ts': `export { default as Widget } from './internal/Widget.svelte';`
		};
		// The internal component is passed as an input so its virtual exists in
		// the program (owned context) — `analyze()` runs without the context
		// closure, and one-shot resolution can't parse raw `.svelte` from disk.
		const result = await analyzeProject(files);
		const api = result.modules.find((m) => m.path === 'api.ts');
		const widget = api?.declarations.find((d) => d.name === 'Widget');
		assert(widget?.kind === 'component');
		assert.deepStrictEqual(widget.aliasOf, { module: 'internal/Widget.svelte', name: 'Widget' });
		assert.deepStrictEqual(api?.externalReExports, []);
		// The gated canonical is analyzed as fill context, so the alias carries
		// its props despite the canonical module emitting nothing.
		assert.strictEqual(widget.props.length, 1);
		assert.strictEqual(widget.props[0]?.name, 'label');
		assert.strictEqual(widget.props[0]?.type, 'string');
		// The gated canonical emits no module.
		assert.deepStrictEqual(
			result.modules.map((m) => m.path),
			['api.ts']
		);
	});

	test('analyzeFromFiles resolves a gated Svelte re-export via the context closure', async () => {
		// Discovery excludes the internal component, so the closure is the only
		// way its virtual enters the program — without it the re-export
		// degrades to an empty `kind: 'variable'` husk with no diagnostic.
		const files: Record<string, string> = {
			'src/lib/internal/Widget.svelte': `<script lang="ts">\n\tlet { label }: { label: string } = $props();\n</script>\n<div>{label}</div>`,
			'src/lib/api.ts': `export { default as Widget } from './internal/Widget.svelte';`
		};
		const result = await withTestProject(files, (projectRoot) =>
			analyzeFromFiles({ projectRoot, discovery: 'glob' })
		);
		assert.deepStrictEqual(
			result.modules.map((m) => m.path),
			['api.ts']
		);
		const widget = result.modules[0]?.declarations.find((d) => d.name === 'Widget');
		assert(widget?.kind === 'component');
		assert.deepStrictEqual(widget.aliasOf, { module: 'internal/Widget.svelte', name: 'Widget' });
		// Closure-owned canonical fills the alias end-to-end from disk discovery.
		assert.strictEqual(widget.props.length, 1);
		assert.strictEqual(widget.props[0]?.name, 'label');
		assert.strictEqual(widget.props[0]?.type, 'string');
	});

	test('genuinely external re-exports still record externalReExports', async () => {
		const result = await analyzeProject(
			{
				'node_modules/mypkg/package.json': JSON.stringify({
					name: 'mypkg',
					main: 'index.js',
					types: 'index.d.ts'
				}),
				'node_modules/mypkg/index.d.ts': `export declare const v: number;`,
				'src/lib/api.ts': `export { v } from 'mypkg';`
			},
			['src/lib/api.ts']
		);
		const api = result.modules.find((m) => m.path === 'api.ts');
		assert.ok(api);
		const external = api.externalReExports[0];
		assert.ok(external);
		assert.strictEqual(api.externalReExports.length, 1);
		assert.strictEqual(external.name, 'v');
		assert.strictEqual(external.specifier, 'mypkg');
		assert.deepStrictEqual(api.declarations, []);
	});
});
