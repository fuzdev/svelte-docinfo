/**
 * Tests for module-path normalization in printed type text.
 *
 * The checker prints a module object as `typeof import("<absolute path>")`,
 * which reaches output through every checker-printed field — `typeSignature`
 * on declarations and members, `returnType`, and the `text`/`name` of a
 * `TypeJson` node. `normalizeModulePathsInTypes` rewrites those paths so
 * output is reproducible across machines, never publishes a local filesystem
 * path, and never leaks the svelte2tsx virtual suffix.
 *
 * Locks the tier contract: a module in this output emits its
 * `ModuleJson.path` (so the string doubles as a lookup key), a package emits
 * the tail after `node_modules/`, anything else in the project emits a
 * root-relative path. Also locks what the pass must *not* touch — author text
 * (`extends` heritage clauses, doc comments) and string-literal types that
 * merely look like paths.
 *
 * The `typeof import(...)` form arises from `import()` expressions and
 * `typeof` over a namespace import; a written `import('./x').T` annotation
 * resolves to the type's own name and never carried a path.
 */

import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test, assert, describe } from 'vitest';

import { analyzeFromFiles } from '$lib/analyze.ts';
import { normalizeDiagnosticPaths } from '$lib/analyze-core.ts';
import type { Diagnostic } from '$lib/diagnostics.ts';
import { SVELTE_VIRTUAL_SUFFIX } from '$lib/source.ts';
import type { ModuleJson } from '$lib/types.ts';

import { withTestProject, withTestDir } from './test-helpers.ts';

/** Every string anywhere in the analysis output, for blanket path assertions. */
const allStrings = (value: unknown, out: Array<string> = []): Array<string> => {
	if (typeof value === 'string') {
		out.push(value);
	} else if (Array.isArray(value)) {
		for (const entry of value) allStrings(entry, out);
	} else if (value !== null && typeof value === 'object') {
		for (const entry of Object.values(value)) allStrings(entry, out);
	}
	return out;
};

const findDeclaration = (modules: Array<ModuleJson>, path: string, name: string) => {
	const mod = modules.find((m) => m.path === path);
	assert.ok(mod, `expected a module at ${path}`);
	const decl = mod.declarations.find((d) => d.name === name);
	assert.ok(decl, `expected declaration ${name} in ${path}`);
	return decl;
};

describe('module paths in printed type text', () => {
	test('a module in the output is referenced by its `ModuleJson.path`', async () => {
		const result = await withTestProject(
			{
				'src/lib/dep.ts': `export const a = 1;`,
				'src/lib/sub/nested.ts': `export const n = 1;`,
				'src/lib/index.ts': `
					export const flat = import('./dep.ts');
					export const nested = import('./sub/nested.ts');
				`
			},
			(projectRoot) => analyzeFromFiles({ projectRoot })
		);

		const flat = findDeclaration(result.modules, 'index.ts', 'flat');
		const nested = findDeclaration(result.modules, 'index.ts', 'nested');
		assert.strictEqual(flat.typeSignature, 'Promise<typeof import("dep.ts")>');
		assert.strictEqual(nested.typeSignature, 'Promise<typeof import("sub/nested.ts")>');

		// The emitted string is a lookup key into `modules` — the contract that
		// lets a renderer linkify without knowing `sourceRoot` (which the
		// output envelope doesn't carry).
		const paths = new Set(result.modules.map((m) => m.path));
		assert.ok(paths.has('dep.ts'));
		assert.ok(paths.has('sub/nested.ts'));
	});

	test('the structured tree is rewritten alongside the flat string', async () => {
		const result = await withTestProject(
			{
				'src/lib/dep.ts': `export const a = 1;`,
				'src/lib/index.ts': `export const m = import('./dep.ts');`
			},
			(projectRoot) => analyzeFromFiles({ projectRoot })
		);

		const decl = findDeclaration(result.modules, 'index.ts', 'm');
		if (decl.kind !== 'variable') throw new Error(`expected a variable, got ${decl.kind}`);
		// the module object is a terminal `other` node (never a reference — its
		// symbol name is the quoted specifier), so the path rides in `text` in
		// the same `import("…")` form as the flat string, rewritten in step.
		assert.deepStrictEqual(decl.typeInfo, {
			kind: 'reference',
			name: 'Promise',
			typeArgs: [{ kind: 'other', text: 'typeof import("dep.ts")' }]
		});
	});

	test('a member type signature is rewritten, not just the declaration', async () => {
		const result = await withTestProject(
			{
				'src/lib/dep.ts': `export const a = 1;`,
				'src/lib/index.ts': `
					import type * as Dep from './dep.ts';
					export interface Holder { d: typeof Dep }
				`
			},
			(projectRoot) => analyzeFromFiles({ projectRoot })
		);

		const decl = findDeclaration(result.modules, 'index.ts', 'Holder');
		if (decl.kind !== 'interface') throw new Error(`expected an interface, got ${decl.kind}`);
		const member = decl.members.find((m) => m.name === 'd');
		assert.ok(member);
		assert.strictEqual(member.typeSignature, 'typeof import("dep.ts")');
	});

	test('a Svelte component drops the svelte2tsx virtual suffix', async () => {
		const result = await withTestProject(
			{
				'src/lib/Wid.svelte': `<script lang="ts">let {p}: {p: string} = $props();</script>\n<div>{p}</div>\n`,
				'src/lib/index.ts': `export const w = import('./Wid.svelte');`
			},
			(projectRoot) => analyzeFromFiles({ projectRoot })
		);

		const decl = findDeclaration(result.modules, 'index.ts', 'w');
		// Not `Wid.svelte.__svelte2tsx__` — the suffix `stripVirtualSuffix`
		// exists to hide would otherwise ship in a public type string.
		assert.strictEqual(decl.typeSignature, 'Promise<typeof import("Wid.svelte")>');
		// the tree's terminal `other` text is the same normalized form
		if (decl.kind !== 'variable') throw new Error(`expected a variable, got ${decl.kind}`);
		assert.deepStrictEqual(decl.typeInfo, {
			kind: 'reference',
			name: 'Promise',
			typeArgs: [{ kind: 'other', text: 'typeof import("Wid.svelte")' }]
		});
	});

	test('a component and its `.svelte.ts` sibling stay distinct', async () => {
		// The Svelte 5 rune-module idiom puts `Foo.svelte` beside `Foo.svelte.ts`.
		// Both elide to the same key, so tier 1 keys on the resolved path instead
		// — otherwise one would claim the other's name.
		const result = await withTestProject(
			{
				'src/lib/Foo.svelte': `<script lang="ts">let {p}: {p: string} = $props();</script>\n<div>{p}</div>\n`,
				'src/lib/Foo.svelte.ts': `export const state = 1;`,
				'src/lib/index.ts': `
					export const component = import('./Foo.svelte');
					export const runes = import('./Foo.svelte.ts');
				`
			},
			(projectRoot) => analyzeFromFiles({ projectRoot })
		);

		const component = findDeclaration(result.modules, 'index.ts', 'component');
		const runes = findDeclaration(result.modules, 'index.ts', 'runes');
		assert.strictEqual(component.typeSignature, 'Promise<typeof import("Foo.svelte")>');
		assert.strictEqual(runes.typeSignature, 'Promise<typeof import("Foo.svelte.ts")>');
	});

	test('a `.d.ts` sibling does not claim the implementation module', async () => {
		// `dep.ts` and `dep.d.ts` elide to the same path, so recovering the
		// extension the checker dropped has to pick one. Ranked by module
		// resolution preference rather than `getSourceFiles()` order, which is
		// unspecified — an iteration order deciding output would defeat the point
		// of a pass that exists to make output reproducible.
		//
		// Locks the outcome, not the mechanism: this passes under first-wins too,
		// because `getSourceFiles()` happens to yield `dep.ts` first here. That's
		// exactly why the ranking exists — nothing in the API promises it will
		// keep doing so, on another TypeScript version or another host.
		const result = await withTestProject(
			{
				'src/lib/dep.ts': `export const a = 1;`,
				'src/lib/dep.d.ts': `export declare const a: number;`,
				'src/lib/index.ts': `export const m = import('./dep.ts');`
			},
			(projectRoot) => analyzeFromFiles({ projectRoot })
		);

		const decl = findDeclaration(result.modules, 'index.ts', 'm');
		assert.strictEqual(decl.typeSignature, 'Promise<typeof import("dep.ts")>');
	});

	test('a package is referenced by its path below `node_modules`', async () => {
		const result = await withTestProject(
			{
				'node_modules/pkg/package.json': JSON.stringify({
					name: 'pkg',
					version: '1.0.0',
					types: 'index.d.ts',
					exports: { '.': './index.js' }
				}),
				'node_modules/pkg/index.d.ts': `export declare const z: number;`,
				'src/lib/index.ts': `export const ext = import('pkg');`
			},
			(projectRoot) => analyzeFromFiles({ projectRoot })
		);

		const decl = findDeclaration(result.modules, 'index.ts', 'ext');
		assert.include(decl.typeSignature ?? '', 'typeof import("pkg/index.d.ts")');
	});

	test('a project file that emits no module is referenced root-relative', async () => {
		const result = await withTestProject(
			{
				'src/other/outside.ts': `export const o = 1;`,
				'src/lib/index.ts': `
					import type * as Out from '../other/outside.ts';
					export interface Holder { o: typeof Out }
				`
			},
			(projectRoot) => analyzeFromFiles({ projectRoot })
		);

		const decl = findDeclaration(result.modules, 'index.ts', 'Holder');
		if (decl.kind !== 'interface') throw new Error(`expected an interface, got ${decl.kind}`);
		const member = decl.members.find((m) => m.name === 'o');
		assert.ok(member);
		// Outside `sourcePaths`, so it emits no module and can't be a lookup
		// key; root-relative is the most it can say.
		assert.strictEqual(member.typeSignature, 'typeof import("src/other/outside.ts")');
	});

	test('a file outside the project is referenced with `../`', async () => {
		// Reachable via a sibling repo or monorepo package imported by path. The
		// relative form isn't guaranteed stable (a distant target's `../` run
		// tracks how deep `projectRoot` sits) but it beats the absolute path it
		// replaces: stable whenever the layout is, and never carrying a home
		// directory.
		await withTestDir(async (dir) => {
			await writeFile(join(dir, 'util.ts'), `export const shared = 1;\n`);
			// `withTestProject` puts the project at `<dir>/proj-<id>`, so
			// `../../../util.ts` from `src/lib/` lands on the sibling above it.
			const result = await withTestProject(
				{
					'src/lib/index.ts': `export const s = import('../../../util.ts');`
				},
				(projectRoot) => analyzeFromFiles({ projectRoot }),
				{ baseDir: dir }
			);

			const decl = findDeclaration(result.modules, 'index.ts', 's');
			assert.strictEqual(decl.typeSignature, 'Promise<typeof import("../util.ts")>');
			// Never confusable with a module in the output — a `ModuleJson.path`
			// can't start with `..` (out-of-root source paths throw).
			assert.ok(!result.modules.some((m) => m.path.startsWith('..')));
		});
	});

	test('no absolute path survives anywhere in the output', async () => {
		const result = await withTestProject(
			{
				'node_modules/pkg/package.json': JSON.stringify({
					name: 'pkg',
					version: '1.0.0',
					types: 'index.d.ts',
					exports: { '.': './index.js' }
				}),
				'node_modules/pkg/index.d.ts': `export declare const z: number;`,
				'src/lib/dep.ts': `export const a = 1;`,
				'src/lib/Wid.svelte': `<script lang="ts">let {p}: {p: string} = $props();</script>\n<div>{p}</div>\n`,
				'src/other/outside.ts': `export const o = 1;`,
				'src/lib/index.ts': `
					import type * as Out from '../other/outside.ts';
					export const a = import('./dep.ts');
					export const b = import('./Wid.svelte');
					export const c = import('pkg');
					export const d = async () => await import('./dep.ts');
					export const e = {m: import('./dep.ts')};
					export interface Holder { o: typeof Out }
				`
			},
			async (projectRoot) => {
				const analyzed = await analyzeFromFiles({ projectRoot });
				const leaked = allStrings(analyzed).filter((s) => s.includes(projectRoot));
				assert.deepStrictEqual(leaked, [], 'no output string may contain the project root');
				return analyzed;
			}
		);
		assert.ok(result.modules.length > 0);
	});

	test('diagnostic messages carry no absolute path', async () => {
		// `.file` is normalized by `normalizeDiagnosticPaths`; `.message` is not,
		// so a producer interpolating an id would bypass the contract.
		await withTestProject(
			{
				'src/lib/broken.svelte': `<script lang="ts">let {a: = $props();</script>`,
				'src/lib/index.ts': `export const a = 1;`
			},
			async (projectRoot) => {
				const result = await analyzeFromFiles({ projectRoot });
				for (const d of result.diagnostics) {
					assert.notInclude(d.message, projectRoot, `diagnostic ${d.kind} leaked a path`);
					assert.notInclude(d.file, projectRoot, `diagnostic ${d.kind} leaked a path in file`);
				}
			}
		);
	});
});

describe('normalizeDiagnosticPaths', () => {
	const diagnostic = (file: string, message = 'msg'): Diagnostic => ({
		kind: 'module_skipped',
		file,
		message,
		severity: 'warning',
		reason: 'no_analyzer'
	});

	test('strips the project root from an in-root path', () => {
		const diagnostics = [diagnostic('/proj/src/lib/a.ts')];
		normalizeDiagnosticPaths(diagnostics, '/proj');
		assert.strictEqual(diagnostics[0]!.file, 'src/lib/a.ts');
	});

	test('relativizes an out-of-root path instead of dropping the leading slash', () => {
		// The old behavior produced `elsewhere/x.ts`, which reads as root-relative
		// but resolves somewhere else — breaking the documented "rejoin with
		// projectRoot" contract. The `../` form makes that rejoin correct, and
		// matches how printed type text names the same file.
		const diagnostics = [diagnostic('/elsewhere/x.ts')];
		normalizeDiagnosticPaths(diagnostics, '/proj');
		assert.strictEqual(diagnostics[0]!.file, '../elsewhere/x.ts');
		assert.strictEqual(resolve('/proj', diagnostics[0]!.file), '/elsewhere/x.ts');
	});

	test('leaves an already-relative path alone', () => {
		// `relative()` would resolve it against `cwd` and produce nonsense.
		const diagnostics = [diagnostic('src/lib/a.ts')];
		normalizeDiagnosticPaths(diagnostics, '/proj');
		assert.strictEqual(diagnostics[0]!.file, 'src/lib/a.ts');
	});

	test('tolerates a trailing slash on projectRoot', () => {
		const diagnostics = [diagnostic('/proj/src/lib/a.ts'), diagnostic('/elsewhere/x.ts')];
		normalizeDiagnosticPaths(diagnostics, '/proj/');
		assert.deepStrictEqual(
			diagnostics.map((d) => d.file),
			['src/lib/a.ts', '../elsewhere/x.ts']
		);
	});

	test('strips the virtual suffix from both file and message', () => {
		const diagnostics = [
			diagnostic(
				`/proj/src/lib/A.svelte${SVELTE_VIRTUAL_SUFFIX}`,
				`failed for /proj/src/lib/A.svelte${SVELTE_VIRTUAL_SUFFIX}`
			)
		];
		normalizeDiagnosticPaths(diagnostics, '/proj');
		assert.strictEqual(diagnostics[0]!.file, 'src/lib/A.svelte');
		assert.strictEqual(diagnostics[0]!.message, 'failed for src/lib/A.svelte');
	});

	test('is idempotent', () => {
		const diagnostics = [diagnostic('/proj/src/lib/a.ts'), diagnostic('/elsewhere/x.ts')];
		normalizeDiagnosticPaths(diagnostics, '/proj');
		const once = diagnostics.map((d) => d.file);
		normalizeDiagnosticPaths(diagnostics, '/proj');
		assert.deepStrictEqual(
			diagnostics.map((d) => d.file),
			once
		);
	});
});

describe('what normalization must not touch', () => {
	test('a string-literal type that looks like a path is left alone', async () => {
		const result = await withTestProject(
			{
				'src/lib/index.ts': `
					export const p = '/usr/bin/env' as const;
					export type Q = '/usr/local/lib';
				`
			},
			(projectRoot) => analyzeFromFiles({ projectRoot })
		);

		// Neither resolves to a file the program loaded, so the rewriter
		// declines them — the resolution check is what keeps literal types safe.
		const p = findDeclaration(result.modules, 'index.ts', 'p');
		const q = findDeclaration(result.modules, 'index.ts', 'Q');
		assert.strictEqual(p.typeSignature, '"/usr/bin/env"');
		assert.strictEqual(q.typeSignature, '"/usr/local/lib"');
	});

	test('a written heritage clause keeps the author’s text', async () => {
		const result = await withTestProject(
			{
				'src/lib/dep.ts': `export class C { c = 1 }`,
				'src/lib/index.ts': `
					export class D extends (await import('./dep.ts')).C {}
				`
			},
			(projectRoot) => analyzeFromFiles({ projectRoot })
		);

		const decl = findDeclaration(result.modules, 'index.ts', 'D');
		if (decl.kind !== 'class') throw new Error(`expected a class, got ${decl.kind}`);
		// `extends` is AST text of what was written, not checker output.
		assert.deepEqual(decl.extends, ["(await import('./dep.ts')).C"]);
	});

	test('a registry-recovered reference keeps its `module` key', async () => {
		// `module` is already a `ModuleJson.path` when `recoveredReference` emits
		// it — the pass must leave it alone (it's on the author-text/relative-path
		// denylist), not re-relativize or otherwise rewrite it
		const result = await withTestProject(
			{
				'src/lib/dep.ts': `
					interface Box {
						out: { a: string };
					}
					export type Inferred = Box['out'];
					export const seed: Inferred = { a: '' };
				`,
				'src/lib/index.ts': `
					import { seed } from './dep.ts';

					export const derived = seed;
					export const m = import('./dep.ts');
				`
			},
			(projectRoot) => analyzeFromFiles({ projectRoot })
		);

		// the pass genuinely ran on this output: the sibling declaration's
		// printed module object was rewritten to the `ModuleJson.path` form
		const m = findDeclaration(result.modules, 'index.ts', 'm');
		assert.strictEqual(m.typeSignature, 'Promise<typeof import("dep.ts")>');

		const derived = findDeclaration(result.modules, 'index.ts', 'derived');
		if (derived.kind !== 'variable') throw new Error(`expected a variable, got ${derived.kind}`);
		assert.deepStrictEqual(derived.typeInfo, {
			kind: 'reference',
			name: 'Inferred',
			module: 'dep.ts'
		});
	});
});
