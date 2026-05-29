import {test, assert, describe} from 'vitest';

import {ComponentDeclarationJson, ModuleJson, type DeclarationKind} from '$lib/types.js';
import {
	findDuplicates,
	sortModules,
	mergeReExports,
	resolveComponentAliases,
	computeDependents,
	type ReExportEntry,
} from '$lib/postprocess.js';
import {type SourceFileInfo} from '$lib/source.js';

/**
 * Create a mock ModuleJson with test declarations.
 *
 * Simplifies test setup by auto-generating minimal declaration metadata.
 *
 * @param path module path (e.g., 'foo.ts', 'Bar.svelte')
 * @param declarations array of declaration objects with name and kind
 * @returns ModuleJson with the specified declarations
 */
/** Parse a partial module through Zod to fill in array defaults. */
const m = (input: {path: string; [key: string]: unknown}): ModuleJson => ModuleJson.parse(input);

const createMockModule = (
	path: string,
	declarations: Array<{name: string; kind: DeclarationKind}>,
): ModuleJson => {
	return m({
		path,
		declarations: declarations.map(({name, kind}) => ({
			name,
			kind,
		})),
	});
};

describe('findDuplicates', () => {
	describe('no duplicates - returns empty Map', () => {
		test('unique declarations across modules', () => {
			const modules = [
				createMockModule('foo.ts', [
					{name: 'foo', kind: 'function'},
					{name: 'bar', kind: 'type'},
				]),
				createMockModule('baz.ts', [
					{name: 'baz', kind: 'class'},
					{name: 'qux', kind: 'variable'},
				]),
			];

			const duplicates = findDuplicates(modules);

			assert.strictEqual(duplicates.size, 0);
		});

		test('empty modules array', () => {
			const modules: Array<ModuleJson> = [];

			const duplicates = findDuplicates(modules);

			assert.strictEqual(duplicates.size, 0);
		});

		test('modules with no declarations', () => {
			const modules = [
				m({path: 'empty.ts', declarations: []}),
				m({path: 'alsoEmpty.ts', declarations: []}),
			];

			const duplicates = findDuplicates(modules);

			assert.strictEqual(duplicates.size, 0);
		});

		test('single module with multiple unique declarations', () => {
			const modules = [
				createMockModule('helpers.ts', [
					{name: 'foo', kind: 'function'},
					{name: 'bar', kind: 'function'},
					{name: 'Baz', kind: 'type'},
					{name: 'Qux', kind: 'class'},
				]),
			];

			const duplicates = findDuplicates(modules);

			assert.strictEqual(duplicates.size, 0);
		});
	});

	describe('duplicates found - returns populated Map', () => {
		test('single duplicate across two modules', () => {
			const modules = [
				createMockModule('foo.ts', [{name: 'Duplicate', kind: 'type'}]),
				createMockModule('bar.ts', [{name: 'Duplicate', kind: 'component'}]),
			];

			const duplicates = findDuplicates(modules);

			assert.strictEqual(duplicates.size, 1);
			assert.ok(duplicates.has('Duplicate'));

			const occurrences = duplicates.get('Duplicate')!;
			assert.strictEqual(occurrences.length, 2);
			// Verify exact module and kind for each occurrence
			const fooOcc = occurrences.find((o) => o.module === 'foo.ts')!;
			const barOcc = occurrences.find((o) => o.module === 'bar.ts')!;
			assert.strictEqual(fooOcc.declaration.kind, 'type');
			assert.strictEqual(barOcc.declaration.kind, 'component');
		});

		test('multiple duplicates', () => {
			const modules = [
				createMockModule('a.ts', [
					{name: 'Dup1', kind: 'type'},
					{name: 'Dup2', kind: 'function'},
				]),
				createMockModule('b.ts', [
					{name: 'Dup1', kind: 'class'},
					{name: 'Dup2', kind: 'variable'},
				]),
			];

			const duplicates = findDuplicates(modules);

			assert.strictEqual(duplicates.size, 2);
			assert.ok(duplicates.has('Dup1'));
			assert.ok(duplicates.has('Dup2'));
		});

		test('same name in 3+ modules', () => {
			const modules = [
				createMockModule('a.ts', [{name: 'Common', kind: 'type'}]),
				createMockModule('b.ts', [{name: 'Common', kind: 'function'}]),
				createMockModule('c.ts', [{name: 'Common', kind: 'class'}]),
			];

			const duplicates = findDuplicates(modules);

			assert.strictEqual(duplicates.size, 1);
			const occurrences = duplicates.get('Common')!;
			assert.strictEqual(occurrences.length, 3);
			const occModules = occurrences.map((o) => o.module).sort();
			assert.deepStrictEqual(occModules, ['a.ts', 'b.ts', 'c.ts']);
		});

		test('includes full declaration for each occurrence', () => {
			const modules = [
				createMockModule('helpers.ts', [{name: 'Foo', kind: 'function'}]),
				createMockModule('Foo.svelte', [{name: 'Foo', kind: 'component'}]),
			];

			const duplicates = findDuplicates(modules);
			const occurrences = duplicates.get('Foo')!;

			assert.ok(occurrences.some((o) => o.declaration.kind === 'function'));
			assert.ok(occurrences.some((o) => o.declaration.kind === 'component'));
			// Verify full declaration is available
			for (const o of occurrences) {
				assert.ok(o.declaration.name === 'Foo');
			}
		});
	});

	describe('edge cases', () => {
		test('detects duplicate when same module appears twice with different declarations', () => {
			const modules = [
				createMockModule('a.ts', [{name: 'Shared', kind: 'type'}]),
				createMockModule('b.ts', [
					{name: 'Shared', kind: 'function'},
					{name: 'Unique', kind: 'variable'},
				]),
			];

			const duplicates = findDuplicates(modules);

			assert.strictEqual(duplicates.size, 1);
			assert.ok(duplicates.has('Shared'));
			assert.ok(!duplicates.has('Unique'));
		});

		test('real-world scenario - DocsLink collision', () => {
			const modules = [
				createMockModule('docsHelpers.svelte.ts', [{name: 'DocsLink', kind: 'type'}]),
				createMockModule('DocsLink.svelte', [{name: 'DocsLink', kind: 'component'}]),
			];

			const duplicates = findDuplicates(modules);

			assert.strictEqual(duplicates.size, 1);
			assert.ok(duplicates.has('DocsLink'));
			const occurrences = duplicates.get('DocsLink')!;
			assert.ok(occurrences.some((o) => o.module === 'docsHelpers.svelte.ts'));
			assert.ok(occurrences.some((o) => o.module === 'DocsLink.svelte'));
		});
	});

	describe('default exports', () => {
		test("skips name === 'default' entries (module-scoped slot)", () => {
			// Two modules each have their own `name: 'default'`. The default slot
			// is module-scoped per the JS spec, so they don't collide globally —
			// `findDuplicates` skips `name === 'default'`.
			const modules = [
				m({
					path: 'a.ts',
					declarations: [{name: 'default', kind: 'function'}],
				}),
				m({
					path: 'b.ts',
					declarations: [{name: 'default', kind: 'function'}],
				}),
			];

			const duplicates = findDuplicates(modules);

			assert.strictEqual(duplicates.size, 0);
		});

		test("name === 'x' alongside name === 'default' in the same module are distinct", () => {
			// `const x; export {x}; export {x as default}` produces two entries:
			// `name: 'x'` and `name: 'default'`. Distinct names, no collision.
			const modules = [
				m({
					path: 'a.ts',
					declarations: [
						{name: 'x', kind: 'variable'},
						{name: 'default', kind: 'variable'},
					],
				}),
			];

			const duplicates = findDuplicates(modules);

			assert.strictEqual(duplicates.size, 0);
		});
	});

	describe('sourceLine tracking', () => {
		test('includes sourceLine when available in declaration', () => {
			const modules = [
				m({
					path: 'foo.ts',
					declarations: [{name: 'Duplicate', kind: 'type', sourceLine: 10}],
				}),
				m({
					path: 'bar.ts',
					declarations: [{name: 'Duplicate', kind: 'function', sourceLine: 25}],
				}),
			];

			const duplicates = findDuplicates(modules);
			const occurrences = duplicates.get('Duplicate')!;

			assert.strictEqual(occurrences.length, 2);
			assert.ok(occurrences.some((o) => o.module === 'foo.ts' && o.declaration.sourceLine === 10));
			assert.ok(occurrences.some((o) => o.module === 'bar.ts' && o.declaration.sourceLine === 25));
		});

		test('handles missing sourceLine in declaration', () => {
			const modules = [
				m({
					path: 'foo.ts',
					declarations: [{name: 'Duplicate', kind: 'type'}], // no sourceLine
				}),
				m({
					path: 'bar.ts',
					declarations: [{name: 'Duplicate', kind: 'function', sourceLine: 25}],
				}),
			];

			const duplicates = findDuplicates(modules);
			const occurrences = duplicates.get('Duplicate')!;

			const fooOccurrence = occurrences.find((o) => o.module === 'foo.ts')!;
			const barOccurrence = occurrences.find((o) => o.module === 'bar.ts')!;

			assert.isUndefined(fooOccurrence.declaration.sourceLine);
			assert.strictEqual(barOccurrence.declaration.sourceLine, 25);
		});
	});
});

describe('sortModules', () => {
	test('sorts modules alphabetically by path', () => {
		const modules = [m({path: 'zebra.ts'}), m({path: 'alpha.ts'}), m({path: 'beta.ts'})];

		const sorted = sortModules(modules);

		assert.strictEqual(sorted[0]!.path, 'alpha.ts');
		assert.strictEqual(sorted[1]!.path, 'beta.ts');
		assert.strictEqual(sorted[2]!.path, 'zebra.ts');
	});

	test('does not mutate original array', () => {
		const modules = [m({path: 'c.ts'}), m({path: 'a.ts'}), m({path: 'b.ts'})];

		const sorted = sortModules(modules);

		// Original array should not be mutated
		assert.strictEqual(modules[0]!.path, 'c.ts');
		assert.strictEqual(modules[1]!.path, 'a.ts');
		assert.strictEqual(modules[2]!.path, 'b.ts');

		// Sorted array should be sorted
		assert.strictEqual(sorted[0]!.path, 'a.ts');
		assert.strictEqual(sorted[1]!.path, 'b.ts');
		assert.strictEqual(sorted[2]!.path, 'c.ts');
	});

	test('handles empty array', () => {
		const sorted = sortModules([]);
		assert.strictEqual(sorted.length, 0);
	});

	test('handles single module', () => {
		const modules = [m({path: 'single.ts'})];
		const sorted = sortModules(modules);
		assert.strictEqual(sorted.length, 1);
		assert.strictEqual(sorted[0]!.path, 'single.ts');
	});

	test('sorts Unicode paths correctly', () => {
		const modules = [m({path: 'über.ts'}), m({path: 'alpha.ts'}), m({path: 'naïve.ts'})];

		const sorted = sortModules(modules);

		assert.strictEqual(sorted[0]!.path, 'alpha.ts');
		assert.strictEqual(sorted[1]!.path, 'naïve.ts');
		assert.strictEqual(sorted[2]!.path, 'über.ts');
	});

	test('stable sort with identical paths', () => {
		const modules = [
			m({path: 'same.ts', declarations: [{name: 'first', kind: 'type'}]}),
			m({path: 'same.ts', declarations: [{name: 'second', kind: 'function'}]}),
		];

		const sorted = sortModules(modules);

		// Should maintain original order for identical paths
		assert.strictEqual(sorted[0]!.declarations[0]!.name, 'first');
		assert.strictEqual(sorted[1]!.declarations[0]!.name, 'second');
	});
});

describe('mergeReExports', () => {
	describe('basic functionality', () => {
		test('merges single re-export into original declaration', () => {
			const modules = [
				m({
					path: 'helpers.ts',
					declarations: [{name: 'helper', kind: 'function'}],
				}),
				m({
					path: 'index.ts',
					declarations: [{name: 'local', kind: 'variable'}],
				}),
			];

			const collectedReExports: Array<ReExportEntry> = [
				{
					reExportingModule: 'index.ts',
					reExport: {name: 'helper', originalModule: 'helpers.ts'},
				},
			];

			mergeReExports(modules, collectedReExports);

			const helpersModule = modules.find((m) => m.path === 'helpers.ts')!;
			const helperDecl = helpersModule.declarations.find((d) => d.name === 'helper')!;

			assert.deepStrictEqual(helperDecl.alsoExportedFrom, ['index.ts']);
		});

		test('merges multiple re-exports for same declaration', () => {
			const modules = [
				m({
					path: 'core.ts',
					declarations: [{name: 'util', kind: 'function'}],
				}),
			];

			const collectedReExports: Array<ReExportEntry> = [
				{
					reExportingModule: 'index.ts',
					reExport: {name: 'util', originalModule: 'core.ts'},
				},
				{
					reExportingModule: 'public.ts',
					reExport: {name: 'util', originalModule: 'core.ts'},
				},
			];

			mergeReExports(modules, collectedReExports);

			const coreModule = modules.find((m) => m.path === 'core.ts')!;
			const utilDecl = coreModule.declarations.find((d) => d.name === 'util')!;

			// Should be sorted alphabetically
			assert.deepStrictEqual(utilDecl.alsoExportedFrom, ['index.ts', 'public.ts']);
		});

		test('handles multiple declarations from same module', () => {
			const modules = [
				m({
					path: 'helpers.ts',
					declarations: [
						{name: 'foo', kind: 'function'},
						{name: 'bar', kind: 'function'},
					],
				}),
			];

			const collectedReExports: Array<ReExportEntry> = [
				{
					reExportingModule: 'index.ts',
					reExport: {name: 'foo', originalModule: 'helpers.ts'},
				},
				{
					reExportingModule: 'index.ts',
					reExport: {name: 'bar', originalModule: 'helpers.ts'},
				},
			];

			mergeReExports(modules, collectedReExports);

			const helpersModule = modules.find((m) => m.path === 'helpers.ts')!;
			const fooDecl = helpersModule.declarations.find((d) => d.name === 'foo')!;
			const barDecl = helpersModule.declarations.find((d) => d.name === 'bar')!;

			assert.deepStrictEqual(fooDecl.alsoExportedFrom, ['index.ts']);
			assert.deepStrictEqual(barDecl.alsoExportedFrom, ['index.ts']);
		});
	});

	describe('edge cases', () => {
		test('handles empty collectedReExports', () => {
			const modules = [
				m({
					path: 'helpers.ts',
					declarations: [{name: 'helper', kind: 'function'}],
				}),
			];

			// Should not throw
			mergeReExports(modules, []);

			const helpersModule = modules.find((m) => m.path === 'helpers.ts')!;
			const helperDecl = helpersModule.declarations.find((d) => d.name === 'helper')!;

			assert.deepStrictEqual(helperDecl.alsoExportedFrom, []);
		});

		test('handles empty modules array', () => {
			const modules: Array<ModuleJson> = [];

			const collectedReExports: Array<ReExportEntry> = [
				{
					reExportingModule: 'index.ts',
					reExport: {name: 'foo', originalModule: 'helpers.ts'},
				},
			];

			// Should not throw
			mergeReExports(modules, collectedReExports);
		});

		test('ignores re-exports for non-existent modules', () => {
			const modules = [
				m({
					path: 'helpers.ts',
					declarations: [{name: 'helper', kind: 'function'}],
				}),
			];

			const collectedReExports: Array<ReExportEntry> = [
				{
					reExportingModule: 'index.ts',
					reExport: {name: 'foo', originalModule: 'nonexistent.ts'},
				},
			];

			// Should not throw
			mergeReExports(modules, collectedReExports);

			// Original module should not be affected
			const helpersModule = modules.find((m) => m.path === 'helpers.ts')!;
			assert.deepStrictEqual(helpersModule.declarations[0]!.alsoExportedFrom, []);
		});

		test('ignores re-exports for non-existent declarations', () => {
			const modules = [
				m({
					path: 'helpers.ts',
					declarations: [{name: 'helper', kind: 'function'}],
				}),
			];

			const collectedReExports: Array<ReExportEntry> = [
				{
					reExportingModule: 'index.ts',
					reExport: {name: 'nonexistent', originalModule: 'helpers.ts'},
				},
			];

			// Should not throw
			mergeReExports(modules, collectedReExports);

			// Original declaration should not be affected
			const helpersModule = modules.find((m) => m.path === 'helpers.ts')!;
			assert.deepStrictEqual(helpersModule.declarations[0]!.alsoExportedFrom, []);
		});

		test('sorts re-exporters alphabetically for determinism', () => {
			const modules = [
				m({
					path: 'core.ts',
					declarations: [{name: 'util', kind: 'function'}],
				}),
			];

			// Add in non-alphabetical order
			const collectedReExports: Array<ReExportEntry> = [
				{
					reExportingModule: 'zebra.ts',
					reExport: {name: 'util', originalModule: 'core.ts'},
				},
				{
					reExportingModule: 'alpha.ts',
					reExport: {name: 'util', originalModule: 'core.ts'},
				},
				{
					reExportingModule: 'beta.ts',
					reExport: {name: 'util', originalModule: 'core.ts'},
				},
			];

			mergeReExports(modules, collectedReExports);

			const coreModule = modules.find((m) => m.path === 'core.ts')!;
			const utilDecl = coreModule.declarations.find((d) => d.name === 'util')!;

			assert.deepStrictEqual(utilDecl.alsoExportedFrom, ['alpha.ts', 'beta.ts', 'zebra.ts']);
		});

		test('is idempotent when invoked twice with the same inputs', () => {
			const modules = [
				m({
					path: 'core.ts',
					declarations: [{name: 'util', kind: 'function'}],
				}),
			];

			const collectedReExports: Array<ReExportEntry> = [
				{
					reExportingModule: 'index.ts',
					reExport: {name: 'util', originalModule: 'core.ts'},
				},
				{
					reExportingModule: 'public.ts',
					reExport: {name: 'util', originalModule: 'core.ts'},
				},
			];

			mergeReExports(modules, collectedReExports);
			const afterFirst = JSON.parse(JSON.stringify(modules));
			mergeReExports(modules, collectedReExports);

			assert.deepStrictEqual(modules, afterFirst);

			const utilDecl = modules[0]!.declarations.find((d) => d.name === 'util')!;
			assert.deepStrictEqual(utilDecl.alsoExportedFrom, ['index.ts', 'public.ts']);
		});

		test('unions new re-exporters with existing entries on subsequent calls', () => {
			const modules = [
				m({
					path: 'core.ts',
					declarations: [{name: 'util', kind: 'function'}],
				}),
			];

			mergeReExports(modules, [
				{
					reExportingModule: 'index.ts',
					reExport: {name: 'util', originalModule: 'core.ts'},
				},
			]);

			// Second pass adds a new re-exporter — first one should be preserved
			mergeReExports(modules, [
				{
					reExportingModule: 'public.ts',
					reExport: {name: 'util', originalModule: 'core.ts'},
				},
			]);

			const utilDecl = modules[0]!.declarations.find((d) => d.name === 'util')!;
			assert.deepStrictEqual(utilDecl.alsoExportedFrom, ['index.ts', 'public.ts']);
		});

		test('dedupes overlap between calls (partial overlap)', () => {
			const modules = [
				m({
					path: 'core.ts',
					declarations: [{name: 'util', kind: 'function'}],
				}),
			];

			mergeReExports(modules, [
				{
					reExportingModule: 'index.ts',
					reExport: {name: 'util', originalModule: 'core.ts'},
				},
				{
					reExportingModule: 'public.ts',
					reExport: {name: 'util', originalModule: 'core.ts'},
				},
			]);

			// Second pass overlaps on 'index.ts' and adds 'extra.ts'
			mergeReExports(modules, [
				{
					reExportingModule: 'index.ts',
					reExport: {name: 'util', originalModule: 'core.ts'},
				},
				{
					reExportingModule: 'extra.ts',
					reExport: {name: 'util', originalModule: 'core.ts'},
				},
			]);

			const utilDecl = modules[0]!.declarations.find((d) => d.name === 'util')!;
			assert.deepStrictEqual(utilDecl.alsoExportedFrom, ['extra.ts', 'index.ts', 'public.ts']);
		});
	});

	describe('resolveComponentAliases (component-only field coverage)', () => {
		// Fields that are intentionally NOT inherited from canonical to alias.
		// Adding a new ComponentDeclarationJson field? Either copy it in
		// `resolveComponentAliases` (postprocess.ts) or add it here with a reason.
		const NOT_INHERITED = new Set<string>([
			// Identity / discriminator — alias has its own.
			'name',
			'kind',
			// Re-export bookkeeping — set by the alias itself, never copied.
			'aliasOf',
			'alsoExportedFrom',
			// Synthesized aliases have no source location per spec.
			'sourceLine',
			// Modifiers reflect the *local* export statement, not the canonical's.
			'modifiers',
		]);

		test('every ComponentDeclarationJson field is either inherited or in NOT_INHERITED', () => {
			const schemaFields = Object.keys(ComponentDeclarationJson.shape);

			// Build canonical with a unique sentinel for every inheritable field.
			const canonical = m({
				path: 'src/A.svelte',
				declarations: [
					{
						name: 'A',
						kind: 'component',
						docComment: 'CANONICAL_DOC',
						typeSignature: 'CANONICAL_SIG',
						sourceLine: 42,
						genericParams: [{name: 'T'}],
						examples: ['CANONICAL_EX'],
						deprecatedMessage: 'CANONICAL_DEP',
						seeAlso: ['CANONICAL_SEE'],
						throws: [{type: 'Error', description: 'CANONICAL_THROW'}],
						since: 'CANONICAL_SINCE',
						mutates: {arg: 'CANONICAL_MUT'},
						partial: true,
						intersects: ['CANONICAL_INT'],
						props: [{name: 'p', type: 'string'}],
						acceptsChildren: true,
						lang: 'js',
					},
				],
			});

			// Build an alias placeholder pointing at canonical.
			const alias = m({
				path: 'src/index.ts',
				declarations: [
					{
						name: 'B',
						kind: 'component',
						aliasOf: {module: 'src/A.svelte', name: 'A'},
					},
				],
			});

			// `mergeReExports` only handles alsoExportedFrom; component-only field
			// inheritance is `resolveComponentAliases`'s job. Both run in `analyzeCore`.
			mergeReExports([canonical, alias], []);
			resolveComponentAliases([canonical, alias]);

			const aliasDecl = alias.declarations[0]!;
			assert.strictEqual(aliasDecl.kind, 'component');
			if (aliasDecl.kind !== 'component') return; // narrow

			const missing: Array<string> = [];
			for (const field of schemaFields) {
				if (NOT_INHERITED.has(field)) continue;
				// Each inheritable field on canonical was given a sentinel — assert
				// the alias acquired the same value (or a non-default one for arrays).
				const aliasValue = (aliasDecl as Record<string, unknown>)[field];
				const canonicalValue = (canonical.declarations[0] as Record<string, unknown>)[field];
				const inherited = JSON.stringify(aliasValue) === JSON.stringify(canonicalValue);
				if (!inherited) missing.push(field);
			}

			assert.deepStrictEqual(
				missing,
				[],
				`resolveComponentAliases failed to inherit these fields from canonical: ${missing.join(', ')}. ` +
					`Either add them to the copy logic in postprocess.ts:resolveComponentAliases ` +
					`or add them to NOT_INHERITED with a reason.`,
			);
		});
	});
});

describe('computeDependents', () => {
	describe('basic functionality', () => {
		test('computes dependents from dependencies', () => {
			const files: Array<SourceFileInfo> = [
				{
					id: '/project/src/lib/math.ts',
					content: 'export const add = (a, b) => a + b;',
				},
				{
					id: '/project/src/lib/Calculator.svelte',
					content: '<script>import {add} from "./math";</script>',
					dependencies: ['/project/src/lib/math.ts'],
				},
			];

			const result = computeDependents(files);

			const mathFile = result.find((f) => f.id.endsWith('math.ts'))!;
			const calcFile = result.find((f) => f.id.endsWith('Calculator.svelte'))!;

			// math.ts should have Calculator.svelte as a dependent
			assert.deepStrictEqual(mathFile.dependents, ['/project/src/lib/Calculator.svelte']);

			// Calculator.svelte should still have its dependencies
			assert.deepStrictEqual(calcFile.dependencies, ['/project/src/lib/math.ts']);
		});

		test('handles multiple dependents', () => {
			const files: Array<SourceFileInfo> = [
				{
					id: '/project/src/lib/utils.ts',
					content: 'export const util = () => {};',
				},
				{
					id: '/project/src/lib/a.ts',
					content: 'import {util} from "./utils";',
					dependencies: ['/project/src/lib/utils.ts'],
				},
				{
					id: '/project/src/lib/b.ts',
					content: 'import {util} from "./utils";',
					dependencies: ['/project/src/lib/utils.ts'],
				},
			];

			const result = computeDependents(files);

			const utilsFile = result.find((f) => f.id.endsWith('utils.ts'))!;

			// utils.ts should have both a.ts and b.ts as dependents, sorted
			assert.deepStrictEqual(utilsFile.dependents, [
				'/project/src/lib/a.ts',
				'/project/src/lib/b.ts',
			]);
		});

		test('handles chain of dependencies', () => {
			const files: Array<SourceFileInfo> = [
				{
					id: '/project/src/lib/core.ts',
					content: 'export const core = 1;',
				},
				{
					id: '/project/src/lib/helpers.ts',
					content: 'import {core} from "./core";',
					dependencies: ['/project/src/lib/core.ts'],
				},
				{
					id: '/project/src/lib/app.ts',
					content: 'import {helper} from "./helpers";',
					dependencies: ['/project/src/lib/helpers.ts'],
				},
			];

			const result = computeDependents(files);

			const coreFile = result.find((f) => f.id.endsWith('core.ts'))!;
			const helpersFile = result.find((f) => f.id.endsWith('helpers.ts'))!;
			const appFile = result.find((f) => f.id.endsWith('app.ts'))!;

			assert.deepStrictEqual(coreFile.dependents, ['/project/src/lib/helpers.ts']);
			assert.deepStrictEqual(helpersFile.dependents, ['/project/src/lib/app.ts']);
			// Verify dependencies are preserved (not clobbered by dependents computation)
			assert.deepStrictEqual(helpersFile.dependencies, ['/project/src/lib/core.ts']);
			assert.deepStrictEqual(appFile.dependencies, ['/project/src/lib/helpers.ts']);
			assert.isUndefined(appFile.dependents); // No one depends on app.ts
		});
	});

	describe('edge cases', () => {
		test('returns files unchanged when no dependencies', () => {
			const files: Array<SourceFileInfo> = [
				{
					id: '/project/src/lib/a.ts',
					content: 'export const a = 1;',
				},
				{
					id: '/project/src/lib/b.ts',
					content: 'export const b = 2;',
				},
			];

			const result = computeDependents(files);

			// Both files should have no dependents
			assert.isUndefined(result[0]!.dependents);
			assert.isUndefined(result[1]!.dependents);
		});

		test('handles empty array', () => {
			const result = computeDependents([]);
			assert.strictEqual(result.length, 0);
		});

		test('ignores dependencies outside the file set', () => {
			const files: Array<SourceFileInfo> = [
				{
					id: '/project/src/lib/app.ts',
					content: 'import {external} from "external-pkg";',
					// Depends on something not in our file set
					dependencies: ['/node_modules/external-pkg/index.js'],
				},
			];

			const result = computeDependents(files);

			// app.ts should have no dependents, and the external dependency is ignored
			assert.isUndefined(result[0]!.dependents);
		});

		test('preserves other file properties', () => {
			const files: Array<SourceFileInfo> = [
				{
					id: '/project/src/lib/math.ts',
					content: 'export const add = (a, b) => a + b;',
				},
				{
					id: '/project/src/lib/app.ts',
					content: 'import {add} from "./math";',
					dependencies: ['/project/src/lib/math.ts'],
				},
			];

			const result = computeDependents(files);

			// Original properties should be preserved
			assert.strictEqual(result[0]!.id, '/project/src/lib/math.ts');
			assert.strictEqual(result[0]!.content, 'export const add = (a, b) => a + b;');
			assert.strictEqual(result[1]!.id, '/project/src/lib/app.ts');
			assert.strictEqual(result[1]!.content, 'import {add} from "./math";');
		});

		test('does not mutate original files', () => {
			const originalFiles: Array<SourceFileInfo> = [
				{
					id: '/project/src/lib/math.ts',
					content: 'export const add = (a, b) => a + b;',
				},
				{
					id: '/project/src/lib/app.ts',
					content: 'import {add} from "./math";',
					dependencies: ['/project/src/lib/math.ts'],
				},
			];
			const snapshot = originalFiles.map((f) => ({...f}));

			computeDependents(originalFiles);

			// Original files should not be mutated — every input field is preserved.
			assert.deepStrictEqual(originalFiles, snapshot);
		});

		test('sorts dependents alphabetically for determinism', () => {
			const files: Array<SourceFileInfo> = [
				{
					id: '/project/src/lib/utils.ts',
					content: 'export const util = () => {};',
				},
				{
					id: '/project/src/lib/zebra.ts',
					content: '',
					dependencies: ['/project/src/lib/utils.ts'],
				},
				{
					id: '/project/src/lib/alpha.ts',
					content: '',
					dependencies: ['/project/src/lib/utils.ts'],
				},
				{
					id: '/project/src/lib/beta.ts',
					content: '',
					dependencies: ['/project/src/lib/utils.ts'],
				},
			];

			const result = computeDependents(files);

			const utilsFile = result.find((f) => f.id.endsWith('utils.ts'))!;

			assert.deepStrictEqual(utilsFile.dependents, [
				'/project/src/lib/alpha.ts',
				'/project/src/lib/beta.ts',
				'/project/src/lib/zebra.ts',
			]);
		});
	});

	describe('windows-shaped inputs (defensive posixification)', () => {
		// `analyze`/`session` already posixify at ingest, so these defensive
		// tests target direct callers with hand-built `SourceFileInfo`.
		test('backslash ids are posixified in output', () => {
			const files: Array<SourceFileInfo> = [
				{
					id: 'C:\\project\\src\\lib\\math.ts',
					content: '',
				},
				{
					id: 'C:\\project\\src\\lib\\Calc.svelte',
					content: '',
					dependencies: ['C:\\project\\src\\lib\\math.ts'],
				},
			];

			const result = computeDependents(files);

			for (const f of result) {
				assert.notInclude(f.id, '\\', `id should be POSIX: ${f.id}`);
				for (const d of f.dependencies ?? []) assert.notInclude(d, '\\');
				for (const d of f.dependents ?? []) assert.notInclude(d, '\\');
			}
		});

		test('backslash dependency ids resolve through reverse-lookup', () => {
			// File A's POSIX id matches file B's backslash dependency entry only
			// after both are posixified — without normalization, the dependent
			// link silently drops.
			const files: Array<SourceFileInfo> = [
				{
					id: 'C:/project/src/lib/math.ts',
					content: '',
				},
				{
					id: 'C:/project/src/lib/Calc.svelte',
					content: '',
					dependencies: ['C:\\project\\src\\lib\\math.ts'],
				},
			];

			const result = computeDependents(files);

			const math = result.find((f) => f.id.endsWith('math.ts'))!;
			assert.deepStrictEqual(math.dependents, ['C:/project/src/lib/Calc.svelte']);
		});

		test('mixed POSIX/backslash batch produces all-POSIX output and resolved links', () => {
			const files: Array<SourceFileInfo> = [
				{id: 'C:/project/src/lib/a.ts', content: ''},
				{
					id: 'C:\\project\\src\\lib\\b.ts',
					content: '',
					dependencies: ['C:/project/src/lib/a.ts'],
				},
				{
					id: 'C:/project/src/lib/c.ts',
					content: '',
					dependencies: ['C:\\project\\src\\lib\\a.ts', 'C:\\project\\src\\lib\\b.ts'],
				},
			];

			const result = computeDependents(files);

			for (const f of result) {
				assert.notInclude(f.id, '\\');
				for (const d of f.dependencies ?? []) assert.notInclude(d, '\\');
				for (const d of f.dependents ?? []) assert.notInclude(d, '\\');
			}
			const a = result.find((f) => f.id.endsWith('a.ts'))!;
			const b = result.find((f) => f.id.endsWith('b.ts'))!;
			assert.deepStrictEqual(a.dependents, ['C:/project/src/lib/b.ts', 'C:/project/src/lib/c.ts']);
			assert.deepStrictEqual(b.dependents, ['C:/project/src/lib/c.ts']);
		});

		test('preserves SourceFileInfo identity when all paths are already POSIX', () => {
			const files: Array<SourceFileInfo> = [
				{id: '/project/src/lib/a.ts', content: ''},
				{
					id: '/project/src/lib/b.ts',
					content: '',
					dependencies: ['/project/src/lib/a.ts'],
				},
			];

			const result = computeDependents(files);

			// `b.ts` gains a computed `dependents` field, so its outer object
			// is rewritten — but the input arrays are passed through `===`-equal.
			const b_in = files[1]!;
			const b_out = result.find((f) => f.id.endsWith('b.ts'))!;
			assert.strictEqual(b_out.dependencies, b_in.dependencies);

			// `a.ts` has no incoming-dependent computation in this case
			// (only b.ts depends on it → computed dependents is non-empty), so
			// its outer object is rewritten too. Pass-through identity is a
			// guarantee on the *arrays*, not the file object itself, since
			// this function's whole purpose is to emit dependents.
		});
	});
});
