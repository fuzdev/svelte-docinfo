/**
 * Tests for namespace re-exports (`export * as ns from './x'`) — detected in
 * `analyzeExports` (`src/lib/typescript-exports.ts`) via the `ValueModule`
 * flag on the deeply-resolved alias, synthesizing `kind: 'namespace'`
 * declarations with a `module` pointer instead of leaking
 * `typeof import("/abs/path")` into `typeSignature`. Covers origination,
 * same-name and renamed chains, star projection, JSDoc/`@nodocs` handling,
 * and path-leak lock-ins.
 */

import { test, assert, describe } from 'vitest';
import { join } from 'node:path';

import { analyze } from '$lib/analyze.ts';
import { hasErrors, hasWarnings } from '$lib/diagnostics.ts';
import type { SourceFileInfo } from '$lib/source.ts';
import { createSourceOptions } from '$lib/source-config.ts';

import { withTestProject } from './test-helpers.ts';

const createSourceFiles = (
	projectRoot: string,
	files: Record<string, string>
): Array<SourceFileInfo> => {
	return Object.entries(files)
		.filter(
			([path]) =>
				path.endsWith('.ts') ||
				path.endsWith('.svelte') ||
				path.endsWith('.css') ||
				path.endsWith('.json')
		)
		.map(([path, content]) => ({
			id: join(projectRoot, path),
			content
		}));
};

const setupAnalysis = (projectRoot: string, files: Record<string, string>) => {
	const sourceFiles = createSourceFiles(projectRoot, files);
	const sourceOptions = createSourceOptions(projectRoot);
	return { sourceFiles, sourceOptions };
};

/**
 * `export * as ns from './x'` synthesizes a `kind: 'namespace'` declaration in
 * the re-exporting module. The declaration carries a `module` field pointing at
 * the source module — consumers that want to render `ns.a`/`ns.b` deref by
 * reading that module's declarations.
 */
describe('namespace re-exports (export * as ns from ./x)', { timeout: 15_000 }, () => {
	test('synthesizes kind:namespace with module pointer; no path leak', async () => {
		const files = {
			'src/lib/x.ts': `
/** First export. */
export const a = 1;
/** Second export. */
export function b(): void {}
/** Third export — a type. */
export type C = {value: string};
`,
			'src/lib/index.ts': `export * as ns from './x.js';`
		};

		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules, diagnostics } = await analyze({ sourceFiles, sourceOptions });

			const indexModule = modules.find((m) => m.path === 'index.ts');
			assert.ok(indexModule);

			// The phantom kind:'variable' is gone — only the namespace declaration.
			const decls = indexModule.declarations;
			assert.strictEqual(decls.length, 1);
			const ns = decls[0]!;
			assert.strictEqual(ns.name, 'ns');
			assert.strictEqual(ns.kind, 'namespace');
			if (ns.kind === 'namespace') {
				assert.strictEqual(ns.module, 'x.ts');
			}
			// Source line points at the export statement in index.ts.
			assert.strictEqual(ns.sourceLine, 1);

			// Star exports remain anonymous-only (`export * from`), unaffected.
			assert.deepStrictEqual(indexModule.starExports, []);

			// No diagnostics — clean handling.
			assert.strictEqual(hasErrors(diagnostics), false);
			assert.strictEqual(hasWarnings(diagnostics), false);

			// The serialized form must not contain any absolute path leak.
			const json = JSON.stringify(modules);
			assert.notMatch(
				json,
				/typeof import\("\//,
				'no `typeof import("/abs/path")` leak in JSON output'
			);
			assert(!json.includes(projectRoot), 'no absolute project path leak in JSON output');
		});
	});

	test('JSDoc on the namespace re-export attaches to the declaration', async () => {
		const files = {
			'src/lib/x.ts': `export const a = 1;`,
			'src/lib/index.ts': `
/** Grouped projection of x's exports.
 * @example import * as ns from 'pkg/index.js';
 */
export * as ns from './x.js';`
		};

		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules } = await analyze({ sourceFiles, sourceOptions });
			const ns = modules
				.find((m) => m.path === 'index.ts')
				?.declarations.find((d) => d.name === 'ns');
			assert.ok(ns);
			assert.strictEqual(ns.kind, 'namespace');
			assert.strictEqual(ns.docComment, "Grouped projection of x's exports.");
			assert.deepStrictEqual(ns.examples, ["import * as ns from 'pkg/index.js';"]);
		});
	});

	test('@nodocs on the namespace re-export marks the declaration', async () => {
		const files = {
			'src/lib/x.ts': `export const a = 1;`,
			'src/lib/index.ts': `
/** @nodocs */
export * as ns from './x.js';`
		};

		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules } = await analyze({ sourceFiles, sourceOptions });
			const indexModule = modules.find((m) => m.path === 'index.ts');
			assert.ok(indexModule);
			// The default await analyze() filter excludes @nodocs declarations from output.
			assert.deepStrictEqual(indexModule.declarations, []);
		});
	});

	test('namespace name participates in flat-namespace duplicate detection', async () => {
		const files = {
			'src/lib/x.ts': `export const value = 1;`,
			'src/lib/y.ts': `export const ns = 'collision';`,
			'src/lib/index.ts': `
export * as ns from './x.js';
export {ns as renamed} from './y.js'; // referenced to keep ns in scope
`
		};

		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules } = await analyze({ sourceFiles, sourceOptions });
			// The namespace declaration is named `ns`; the variable in y.ts is also `ns`.
			// findDuplicates is consumer-side, but the declaration's `name` field
			// participates in the flat namespace just like any other declaration.
			const indexNs = modules
				.find((m) => m.path === 'index.ts')
				?.declarations.find((d) => d.name === 'ns');
			const yNs = modules.find((m) => m.path === 'y.ts')?.declarations.find((d) => d.name === 'ns');
			assert.ok(indexNs);
			assert.ok(yNs);
			assert.strictEqual(indexNs.kind, 'namespace');
			assert.strictEqual(yNs.kind, 'variable');
		});
	});

	test('cross-file same-name re-export of a namespace links via alsoExportedFrom', async () => {
		const files = {
			'src/lib/x.ts': `export const a = 1;`,
			'src/lib/index.ts': `export * as ns from './x.js';`,
			'src/lib/barrel.ts': `export {ns} from './index.js';`
		};
		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules } = await analyze({ sourceFiles, sourceOptions });
			const barrel = modules.find((m) => m.path === 'barrel.ts');
			const indexNs = modules
				.find((m) => m.path === 'index.ts')
				?.declarations.find((d) => d.name === 'ns');
			assert.ok(indexNs);
			assert.deepStrictEqual(barrel?.declarations, []);
			assert.deepStrictEqual(indexNs.alsoExportedFrom, ['barrel.ts']);
		});
	});

	test('star re-export of a module containing a namespace is silent — starExports is the sole encoding', async () => {
		// The star-projected `ns` binding shares index.ts's `NamespaceExport`
		// node. Like every star-projected binding, it is not materialized in the
		// projecting module: no declaration, no `reExports` edge, no
		// `alsoExportedFrom` back-link.
		const files = {
			'src/lib/x.ts': `export const a = 1;`,
			'src/lib/index.ts': `export * as ns from './x.js';`,
			'src/lib/barrel-star.ts': `export * from './index.js';`
		};
		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules } = await analyze({ sourceFiles, sourceOptions });
			const barrelStar = modules.find((m) => m.path === 'barrel-star.ts');
			const indexNs = modules
				.find((m) => m.path === 'index.ts')
				?.declarations.find((d) => d.name === 'ns');
			assert.ok(indexNs);
			assert.deepStrictEqual(
				barrelStar?.declarations,
				[],
				'no duplicate ns declaration in the star-importing module'
			);
			assert.deepStrictEqual(barrelStar?.starExports, ['index.ts']);
			assert.deepStrictEqual(barrelStar?.reExports, []);
			assert.deepStrictEqual(indexNs.alsoExportedFrom, []);
		});
	});

	test('star projection of a namespace re-export specifier is silent too', async () => {
		// barrel-star projects b.ts's `export {ns}` specifier — a foreign
		// `ExportSpecifier` binding rather than the `NamespaceExport` node.
		// b.ts keeps its own forward edge and back-link; the star-projecting
		// module gets only `starExports`.
		const files = {
			'src/lib/x.ts': `export const a = 1;`,
			'src/lib/index.ts': `export * as ns from './x.js';`,
			'src/lib/b.ts': `export {ns} from './index.js';`,
			'src/lib/barrel-star.ts': `export * from './b.js';`
		};
		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules } = await analyze({ sourceFiles, sourceOptions });
			const barrelStar = modules.find((m) => m.path === 'barrel-star.ts')!;
			assert.deepStrictEqual(barrelStar.declarations, []);
			assert.deepStrictEqual(barrelStar.reExports, []);
			assert.deepStrictEqual(barrelStar.starExports, ['b.ts']);
			const bModule = modules.find((m) => m.path === 'b.ts')!;
			assert.deepStrictEqual(bModule.reExports, [
				{ name: 'ns', module: 'index.ts', typeOnly: false, sourceLine: 1 }
			]);
			const indexNs = modules
				.find((m) => m.path === 'index.ts')!
				.declarations.find((d) => d.name === 'ns');
			assert.deepStrictEqual(indexNs?.alsoExportedFrom, ['b.ts']);
		});
	});

	test('renamed cross-file re-export of a namespace synthesizes a kind:namespace alias', async () => {
		const files = {
			'src/lib/x.ts': `export const a = 1;`,
			'src/lib/index.ts': `export * as ns from './x.js';`,
			'src/lib/renamed.ts': `
/** A friendlier name for ns. */
export {ns as renamedNs} from './index.js';`
		};
		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules } = await analyze({ sourceFiles, sourceOptions });
			const renamed = modules.find((m) => m.path === 'renamed.ts');
			assert.ok(renamed);
			assert.strictEqual(renamed.declarations.length, 1);
			const decl = renamed.declarations[0]!;
			assert.strictEqual(decl.name, 'renamedNs');
			assert.strictEqual(decl.kind, 'namespace');
			if (decl.kind === 'namespace') {
				// `module` points to the source the namespace projects (not the
				// namespace-defining module).
				assert.strictEqual(decl.module, 'x.ts');
			}
			// aliasOf points to the canonical namespace declaration in index.ts.
			assert.deepStrictEqual(decl.aliasOf, {
				module: 'index.ts',
				name: 'ns'
			});
			assert.strictEqual(decl.docComment, 'A friendlier name for ns.');
			// Synthesized alias points at the local export specifier's line.
			assert.strictEqual(decl.sourceLine, 3);

			// No path leak in the JSON output.
			const json = JSON.stringify(modules);
			assert.notMatch(json, /typeof import\("\//);
		});
	});

	test('namespace re-export of a Svelte module points module at the .svelte file', async () => {
		const files = {
			'src/lib/Foo.svelte': `<script lang="ts">
let {label}: {label: string} = $props();
</script>
<button>{label}</button>`,
			'src/lib/index.ts': `export * as FooNs from './Foo.svelte';`
		};

		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules } = await analyze({ sourceFiles, sourceOptions });
			const ns = modules
				.find((m) => m.path === 'index.ts')
				?.declarations.find((d) => d.name === 'FooNs');
			assert.ok(ns);
			assert.strictEqual(ns.kind, 'namespace');
			if (ns.kind === 'namespace') {
				assert.strictEqual(ns.module, 'Foo.svelte');
			}
		});
	});

	// Lock-in tests for the chained-namespace path-leak fix. Detection used to
	// rely on `getImmediateAliasedSymbol(exportSymbol).declarations[0]` being a
	// `NamespaceExport`, which fails when intermediate hops are `ExportSpecifier`
	// nodes. The fix uses the `ValueModule` flag on the deeply-resolved alias,
	// which is robust to arbitrary chain depth.
	test('3-hop chain (origination → same-name → renamed) classifies as renamed and points aliasOf at the origination', async () => {
		const files = {
			'src/lib/x.ts': `export const a = 1;`,
			'src/lib/a.ts': `export * as ns from './x.js';`,
			'src/lib/b.ts': `export {ns} from './a.js';`,
			'src/lib/c.ts': `export {ns as foo} from './b.js';`
		};
		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules } = await analyze({ sourceFiles, sourceOptions });

			const c = modules.find((m) => m.path === 'c.ts');
			assert.ok(c);
			assert.strictEqual(c.declarations.length, 1);
			const foo = c.declarations[0]!;
			assert.strictEqual(foo.name, 'foo');
			assert.strictEqual(foo.kind, 'namespace');
			if (foo.kind === 'namespace') {
				// `module` points to the source the namespace projects (x.ts),
				// not the abs-path leak that the previous detection produced.
				assert.strictEqual(foo.module, 'x.ts');
			}
			// aliasOf walks the chain to the canonical NamespaceExport in a.ts,
			// not the deeply-resolved module symbol (which would have an abs-path name).
			assert.deepStrictEqual(foo.aliasOf, { module: 'a.ts', name: 'ns' });
			assert.strictEqual(foo.sourceLine, 1);

			// b.ts's same-name re-export still links via alsoExportedFrom on a.ts's ns.
			const aNs = modules.find((m) => m.path === 'a.ts')?.declarations.find((d) => d.name === 'ns');
			assert.ok(aNs);
			assert.deepStrictEqual(aNs.alsoExportedFrom, ['b.ts']);

			// No path leak anywhere in the JSON output.
			const json = JSON.stringify(modules);
			assert.notMatch(json, /typeof import\("\//, 'no typeof import("/abs/path") leak');
			assert(!json.includes(projectRoot), 'no absolute project path leak');
		});
	});

	test('4-hop chain crossing same-name and renamed segments resolves correctly with no path leak', async () => {
		const files = {
			'src/lib/x.ts': `export const a = 1;`,
			'src/lib/a.ts': `export * as ns from './x.js';`,
			'src/lib/b.ts': `export {ns as renamed} from './a.js';`,
			'src/lib/c.ts': `export {renamed} from './b.js';`,
			'src/lib/d.ts': `export {renamed as final} from './c.js';`
		};
		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules } = await analyze({ sourceFiles, sourceOptions });

			// b.ts's renamed alias declaration is the upstream rename.
			const b = modules.find((m) => m.path === 'b.ts');
			const bRenamed = b?.declarations.find((d) => d.name === 'renamed');
			assert.ok(bRenamed);
			assert.strictEqual(bRenamed.kind, 'namespace');
			if (bRenamed.kind === 'namespace') {
				assert.strictEqual(bRenamed.module, 'x.ts');
			}
			assert.deepStrictEqual(bRenamed.aliasOf, { module: 'a.ts', name: 'ns' });
			// c.ts's same-name re-export links to b.ts's renamed alias.
			assert.deepStrictEqual(bRenamed.alsoExportedFrom, ['c.ts']);

			// d.ts's renamed re-export synthesizes a fresh alias pointing at the
			// upstream NamespaceExport (a.ts's ns), not the intermediate b.ts/renamed.
			// This matches the rename-then-rename semantics for non-namespace decls.
			const d = modules.find((m) => m.path === 'd.ts');
			const final = d?.declarations.find((dd) => dd.name === 'final');
			assert.ok(final);
			assert.strictEqual(final.kind, 'namespace');
			if (final.kind === 'namespace') {
				assert.strictEqual(final.module, 'x.ts');
			}
			assert.deepStrictEqual(final.aliasOf, { module: 'a.ts', name: 'ns' });

			const json = JSON.stringify(modules);
			assert.notMatch(json, /typeof import\("\//, 'no typeof import("/abs/path") leak');
			assert(!json.includes(projectRoot), 'no absolute project path leak');
		});
	});

	test('JSDoc on a same-name cross-file namespace re-export synthesizes a kind:namespace alias and still links the canonical', async () => {
		// Position 3 (content-conditional synthesis): when the local statement
		// carries JSDoc, synthesize an alias declaration so the local content
		// has somewhere to live, AND keep the alsoExportedFrom link.
		const files = {
			'src/lib/x.ts': `export const a = 1;`,
			'src/lib/index.ts': `export * as ns from './x.js';`,
			'src/lib/barrel.ts': `
/** Re-projected for convenience.
 * @example import {ns} from 'pkg/barrel.js';
 */
export {ns} from './index.js';`
		};
		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules } = await analyze({ sourceFiles, sourceOptions });

			const barrel = modules.find((m) => m.path === 'barrel.ts');
			assert.ok(barrel);
			const barrelNs = barrel.declarations.find((d) => d.name === 'ns');
			assert.ok(barrelNs, 'barrel.ts synthesizes a ns alias declaration when JSDoc is present');
			assert.strictEqual(barrelNs.kind, 'namespace');
			if (barrelNs.kind === 'namespace') {
				assert.strictEqual(barrelNs.module, 'x.ts');
			}
			assert.deepStrictEqual(barrelNs.aliasOf, {
				module: 'index.ts',
				name: 'ns'
			});
			assert.strictEqual(barrelNs.docComment, 'Re-projected for convenience.');
			assert.deepStrictEqual(barrelNs.examples, ["import {ns} from 'pkg/barrel.js';"]);
			assert.strictEqual(barrelNs.sourceLine, 5);

			// alsoExportedFrom on the canonical is preserved (link + alias coexist).
			const indexNs = modules
				.find((m) => m.path === 'index.ts')
				?.declarations.find((d) => d.name === 'ns');
			assert.ok(indexNs);
			assert.deepStrictEqual(indexNs.alsoExportedFrom, ['barrel.ts']);

			const json = JSON.stringify(modules);
			assert.notMatch(json, /typeof import\("\//, 'no typeof import("/abs/path") leak');
			assert(!json.includes(projectRoot), 'no absolute project path leak');
		});
	});

	test('@nodocs on a same-name cross-file namespace re-export suppresses both the alias and the alsoExportedFrom link', async () => {
		const files = {
			'src/lib/x.ts': `export const a = 1;`,
			'src/lib/index.ts': `export * as ns from './x.js';`,
			'src/lib/barrel.ts': `
/** @nodocs */
export {ns} from './index.js';`
		};
		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules } = await analyze({ sourceFiles, sourceOptions });

			// The default await analyze() filter excludes @nodocs declarations, and
			// the alsoExportedFrom link was suppressed.
			const barrel = modules.find((m) => m.path === 'barrel.ts');
			assert.deepStrictEqual(barrel?.declarations, []);
			const indexNs = modules
				.find((m) => m.path === 'index.ts')
				?.declarations.find((d) => d.name === 'ns');
			assert.ok(indexNs);
			assert.deepStrictEqual(indexNs.alsoExportedFrom, []);
		});
	});

	test('chain ending in same-name links to the upstream renamed alias via alsoExportedFrom (no synthesized decl)', async () => {
		const files = {
			'src/lib/x.ts': `export const a = 1;`,
			'src/lib/a.ts': `export * as ns from './x.js';`,
			'src/lib/b.ts': `export {ns as foo} from './a.js';`,
			'src/lib/c.ts': `export {foo} from './b.js';`
		};
		await withTestProject(files, async (projectRoot) => {
			const { sourceFiles, sourceOptions } = setupAnalysis(projectRoot, files);
			const { modules } = await analyze({ sourceFiles, sourceOptions });

			// b.ts holds the canonical-for-name (the renamed alias `foo`).
			const b = modules.find((m) => m.path === 'b.ts');
			const bFoo = b?.declarations.find((d) => d.name === 'foo');
			assert.ok(bFoo);
			assert.strictEqual(bFoo.kind, 'namespace');
			assert.deepStrictEqual(bFoo.alsoExportedFrom, ['c.ts']);

			// c.ts has no duplicate declaration — same-name re-export only links.
			const c = modules.find((m) => m.path === 'c.ts');
			assert.deepStrictEqual(c?.declarations, []);

			const json = JSON.stringify(modules);
			assert.notMatch(json, /typeof import\("\//, 'no typeof import("/abs/path") leak');
			assert(!json.includes(projectRoot), 'no absolute project path leak');
		});
	});
});
