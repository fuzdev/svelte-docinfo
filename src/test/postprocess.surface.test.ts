/**
 * Tests for `resolveExportSurface` — full export-surface resolution over the
 * analyzed model, including ES star-export semantics (explicit-beats-star
 * shadowing, ambiguity exclusion, no `default` projection), Position-3
 * overlap dedup, external re-exports, and incompleteness reporting.
 */

import {test, assert, describe} from 'vitest';

import {ModuleJson} from '$lib/types.js';
import {resolveExportSurface} from '$lib/postprocess.js';

/** Parse a partial module through Zod to fill in array defaults. */
const m = (input: {path: string; [key: string]: unknown}): ModuleJson => ModuleJson.parse(input);

/** Project entries to a comparable `{name, via, module?}` shape. */
const names = (
	surface: NonNullable<ReturnType<typeof resolveExportSurface>>,
): Array<{name: string; via: string; module?: string}> =>
	surface.entries.map(({name, via, module}) => ({name, via, ...(module ? {module} : {})}));

describe('resolveExportSurface', () => {
	test('returns null for a path not in the analyzed set', () => {
		assert.strictEqual(resolveExportSurface([m({path: 'a.ts'})], 'missing.ts'), null);
	});

	test('own declarations surface via declaration, sorted by name', () => {
		const modules = [
			m({
				path: 'a.ts',
				declarations: [
					{name: 'zeta', kind: 'function'},
					{name: 'alpha', kind: 'variable'},
				],
			}),
		];

		const surface = resolveExportSurface(modules, 'a.ts')!;
		assert.deepStrictEqual(names(surface), [
			{name: 'alpha', via: 'declaration', module: 'a.ts'},
			{name: 'zeta', via: 'declaration', module: 'a.ts'},
		]);
		assert.deepStrictEqual(surface.unresolvedStarExports, []);
		assert.deepStrictEqual(surface.externalStarExports, []);
	});

	test('same-name edges surface via reExport with the canonical declaration resolved', () => {
		const modules = [
			m({path: 'a.ts', declarations: [{name: 'foo', kind: 'variable'}]}),
			m({path: 'index.ts', reExports: [{name: 'foo', module: 'a.ts'}]}),
		];

		const surface = resolveExportSurface(modules, 'index.ts')!;
		assert.strictEqual(surface.entries.length, 1);
		const entry = surface.entries[0]!;
		assert.strictEqual(entry.via, 'reExport');
		assert.strictEqual(entry.module, 'a.ts');
		assert.strictEqual(entry.declaration?.name, 'foo');
	});

	test('colliding edge names keep the first edge in sort order', () => {
		// `export {default} from './Foo.svelte'` (re-keyed to 'Foo') collides
		// with a same-name re-export of an unrelated `Foo` — the surface is
		// keyed by name, so the edge sorting first by module wins.
		const modules = [
			m({path: 'Foo.svelte', declarations: [{name: 'Foo', kind: 'component'}]}),
			m({path: 'other.ts', declarations: [{name: 'Foo', kind: 'variable'}]}),
			m({
				path: 'barrel.ts',
				reExports: [
					{name: 'Foo', module: 'Foo.svelte'},
					{name: 'Foo', module: 'other.ts'},
				],
			}),
		];

		const surface = resolveExportSurface(modules, 'barrel.ts')!;
		assert.deepStrictEqual(names(surface), [{name: 'Foo', via: 'reExport', module: 'Foo.svelte'}]);
	});

	test('an edge whose canonical module is outside the set surfaces without a declaration', () => {
		// Session with a partial owned set — the forward edge persists (see the
		// presence caveats on `ReExportJson`), so the surface reports it with
		// the canonical module but no resolved declaration.
		const modules = [m({path: 'barrel.ts', reExports: [{name: 'foo', module: 'unowned.ts'}]})];

		const surface = resolveExportSurface(modules, 'barrel.ts')!;
		assert.deepStrictEqual(surface.entries, [{name: 'foo', via: 'reExport', module: 'unowned.ts'}]);
	});

	test("a module's own default appears on its own surface", () => {
		const modules = [m({path: 'a.ts', declarations: [{name: 'default', kind: 'function'}]})];

		const surface = resolveExportSurface(modules, 'a.ts')!;
		assert.deepStrictEqual(
			surface.entries.map((e) => ({name: e.name, via: e.via})),
			[{name: 'default', via: 'declaration'}],
		);
	});

	test('a Position-3 alias and its edge collapse to one declaration entry carrying typeOnly', () => {
		const modules = [
			m({path: 'a.ts', declarations: [{name: 'A', kind: 'interface'}]}),
			m({
				path: 'index.ts',
				declarations: [{name: 'A', kind: 'interface', aliasOf: {module: 'a.ts', name: 'A'}}],
				reExports: [{name: 'A', module: 'a.ts', typeOnly: true}],
			}),
		];

		const surface = resolveExportSurface(modules, 'index.ts')!;
		assert.strictEqual(surface.entries.length, 1);
		const entry = surface.entries[0]!;
		assert.strictEqual(entry.via, 'declaration');
		assert.strictEqual(entry.typeOnly, true);
	});

	test('external re-exports surface via external; external stars are reported not guessed', () => {
		const modules = [
			m({
				path: 'index.ts',
				externalReExports: [
					{name: 'ext', specifier: 'pkg'},
					{name: 'renamed', specifier: 'pkg', originalName: 'orig', typeOnly: true},
				],
				externalStarExports: ['otherpkg'],
			}),
		];

		const surface = resolveExportSurface(modules, 'index.ts')!;
		assert.deepStrictEqual(surface.entries, [
			{name: 'ext', via: 'external', specifier: 'pkg'},
			{name: 'renamed', via: 'external', specifier: 'pkg', originalName: 'orig', typeOnly: true},
		]);
		assert.deepStrictEqual(surface.externalStarExports, ['otherpkg']);
	});

	describe('star projection', () => {
		test('projects declarations, edges, and externals through a star', () => {
			const modules = [
				m({path: 'x.ts', declarations: [{name: 'deep', kind: 'variable'}]}),
				m({
					path: 'b.ts',
					declarations: [{name: 'own', kind: 'function'}],
					reExports: [{name: 'deep', module: 'x.ts'}],
					externalReExports: [{name: 'ext', specifier: 'pkg'}],
				}),
				m({path: 'index.ts', starExports: ['b.ts']}),
			];

			const surface = resolveExportSurface(modules, 'index.ts')!;
			assert.deepStrictEqual(
				surface.entries.map(({name, via, starFrom}) => ({name, via, starFrom})),
				[
					{name: 'deep', via: 'star', starFrom: 'b.ts'},
					{name: 'ext', via: 'star', starFrom: 'b.ts'},
					{name: 'own', via: 'star', starFrom: 'b.ts'},
				],
			);
			// underlying canonical info is preserved
			assert.strictEqual(surface.entries[0]!.module, 'x.ts');
			assert.strictEqual(surface.entries[1]!.specifier, 'pkg');
		});

		test('explicit exports shadow star-projected names', () => {
			const modules = [
				m({path: 'b.ts', declarations: [{name: 'foo', kind: 'variable'}]}),
				m({
					path: 'index.ts',
					declarations: [{name: 'foo', kind: 'function'}],
					starExports: ['b.ts'],
				}),
			];

			const surface = resolveExportSurface(modules, 'index.ts')!;
			assert.deepStrictEqual(names(surface), [
				{name: 'foo', via: 'declaration', module: 'index.ts'},
			]);
		});

		test('a name ambiguous between two stars is excluded per ES semantics', () => {
			const modules = [
				m({path: 'b.ts', declarations: [{name: 'foo', kind: 'variable'}]}),
				m({path: 'c.ts', declarations: [{name: 'foo', kind: 'function'}]}),
				m({path: 'index.ts', starExports: ['b.ts', 'c.ts']}),
			];

			const surface = resolveExportSurface(modules, 'index.ts')!;
			assert.deepStrictEqual(surface.entries, []);
		});

		test('the same canonical through a diamond is included once', () => {
			const modules = [
				m({path: 'a.ts', declarations: [{name: 'foo', kind: 'variable'}]}),
				m({path: 'b.ts', reExports: [{name: 'foo', module: 'a.ts'}]}),
				m({path: 'c.ts', reExports: [{name: 'foo', module: 'a.ts'}]}),
				m({path: 'index.ts', starExports: ['b.ts', 'c.ts']}),
			];

			const surface = resolveExportSurface(modules, 'index.ts')!;
			assert.deepStrictEqual(names(surface), [{name: 'foo', via: 'star', module: 'a.ts'}]);
		});

		test('aliases of the same canonical through two stars also merge', () => {
			// b.ts and c.ts both rename a.ts#foo to bar — same binding, not ambiguous
			const modules = [
				m({path: 'a.ts', declarations: [{name: 'foo', kind: 'variable'}]}),
				m({
					path: 'b.ts',
					declarations: [{name: 'bar', kind: 'variable', aliasOf: {module: 'a.ts', name: 'foo'}}],
				}),
				m({
					path: 'c.ts',
					declarations: [{name: 'bar', kind: 'variable', aliasOf: {module: 'a.ts', name: 'foo'}}],
				}),
				m({path: 'index.ts', starExports: ['b.ts', 'c.ts']}),
			];

			const surface = resolveExportSurface(modules, 'index.ts')!;
			assert.deepStrictEqual(
				surface.entries.map((e) => e.name),
				['bar'],
			);
		});

		test('default and canonical Svelte components do not project; component aliases do', () => {
			const modules = [
				m({
					path: 'Foo.svelte',
					declarations: [
						{name: 'Foo', kind: 'component'},
						{name: 'helper', kind: 'function'},
					],
				}),
				m({path: 'a.ts', declarations: [{name: 'default', kind: 'function'}]}),
				m({
					path: 'b.ts',
					declarations: [
						{name: 'Renamed', kind: 'component', aliasOf: {module: 'Foo.svelte', name: 'Foo'}},
					],
				}),
				m({path: 'index.ts', starExports: ['Foo.svelte', 'a.ts', 'b.ts']}),
			];

			const surface = resolveExportSurface(modules, 'index.ts')!;
			assert.deepStrictEqual(
				surface.entries.map((e) => e.name),
				['helper', 'Renamed'],
			);
		});

		test('a star-projected edge whose canonical is a component is treated as a default-slot re-export', () => {
			// b.ts: `export {default} from './Foo.svelte'` → re-keyed edge {Foo}.
			// The runtime name is `default`, which a star does not project.
			const modules = [
				m({path: 'Foo.svelte', declarations: [{name: 'Foo', kind: 'component'}]}),
				m({path: 'b.ts', reExports: [{name: 'Foo', module: 'Foo.svelte'}]}),
				m({path: 'index.ts', starExports: ['b.ts']}),
			];

			const surface = resolveExportSurface(modules, 'index.ts')!;
			assert.deepStrictEqual(surface.entries, []);
		});

		test('transitive star chains resolve through intermediate modules', () => {
			const modules = [
				m({path: 'a.ts', declarations: [{name: 'deep', kind: 'variable'}]}),
				m({path: 'b.ts', starExports: ['a.ts']}),
				m({path: 'index.ts', starExports: ['b.ts']}),
			];

			const surface = resolveExportSurface(modules, 'index.ts')!;
			assert.deepStrictEqual(names(surface), [{name: 'deep', via: 'star', module: 'a.ts'}]);
			// starFrom is the immediate hop, not the origin
			assert.strictEqual(surface.entries[0]!.starFrom, 'b.ts');
		});

		test('cyclic star graphs terminate', () => {
			const modules = [
				m({path: 'a.ts', declarations: [{name: 'fromA', kind: 'variable'}], starExports: ['b.ts']}),
				m({path: 'b.ts', declarations: [{name: 'fromB', kind: 'variable'}], starExports: ['a.ts']}),
			];

			const surface = resolveExportSurface(modules, 'a.ts')!;
			assert.deepStrictEqual(
				surface.entries.map((e) => e.name),
				['fromA', 'fromB'],
			);
		});

		test('a surface resolved inside a cycle does not leak to sibling star paths', () => {
			// p owns X and stars b; b stars p (cycle) and a1, which owns a
			// different X. Resolving b under p's star contributes nothing along
			// the back-edge, so that path-relative surface keeps a1's X instead
			// of excluding it as ambiguous — were it memoized, q would inherit
			// it and r would see a phantom ambiguity (p's X vs a1's X) and
			// export nothing. ES truth: b's X is ambiguous so b exports no X;
			// r exports p's X via the star of p.
			const modules = [
				m({path: 'p.ts', declarations: [{name: 'X', kind: 'variable'}], starExports: ['b.ts']}),
				m({path: 'b.ts', starExports: ['p.ts', 'a1.ts']}),
				m({path: 'a1.ts', declarations: [{name: 'X', kind: 'function'}]}),
				m({path: 'q.ts', starExports: ['b.ts']}),
				m({path: 'r.ts', starExports: ['p.ts', 'q.ts']}),
			];

			const r = resolveExportSurface(modules, 'r.ts')!;
			assert.deepStrictEqual(
				r.entries.map((e) => ({name: e.name, via: e.via, starFrom: e.starFrom})),
				[{name: 'X', via: 'star', starFrom: 'p.ts'}],
			);
			assert.strictEqual(r.entries[0]!.declaration?.kind, 'variable');

			// b queried directly excludes the ambiguous X
			const b = resolveExportSurface(modules, 'b.ts')!;
			assert.deepStrictEqual(b.entries, []);
		});

		test('star targets outside the analyzed set are reported as unresolved', () => {
			const modules = [
				m({
					path: 'index.ts',
					starExports: ['missing.ts'],
					declarations: [{name: 'own', kind: 'variable'}],
				}),
			];

			const surface = resolveExportSurface(modules, 'index.ts')!;
			assert.deepStrictEqual(
				surface.entries.map((e) => e.name),
				['own'],
			);
			assert.deepStrictEqual(surface.unresolvedStarExports, ['missing.ts']);
		});

		test('unresolved star targets aggregate transitively', () => {
			const modules = [
				m({path: 'b.ts', starExports: ['missing.ts']}),
				m({path: 'index.ts', starExports: ['b.ts']}),
			];

			const surface = resolveExportSurface(modules, 'index.ts')!;
			assert.deepStrictEqual(surface.unresolvedStarExports, ['missing.ts']);
		});

		test('external stars aggregate transitively', () => {
			const modules = [
				m({path: 'b.ts', externalStarExports: ['pkg-b']}),
				m({path: 'index.ts', starExports: ['b.ts'], externalStarExports: ['pkg-a']}),
			];

			const surface = resolveExportSurface(modules, 'index.ts')!;
			assert.deepStrictEqual(surface.externalStarExports, ['pkg-a', 'pkg-b']);
		});
	});
});
