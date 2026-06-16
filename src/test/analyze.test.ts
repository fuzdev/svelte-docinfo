/**
 * Tests for analyze.ts - the main library analysis function.
 *
 * These tests cover:
 * - Basic analysis workflow
 * - Duplicate detection and callbacks
 * - Diagnostic reporting via logger
 * - Two-phase re-export resolution
 * - Bidirectional dependency computation
 * - @nodocs filtering
 * - Deterministic output
 */

import {test, assert, describe} from 'vitest';
import {join} from 'node:path';

import {analyze, type AnalyzeOptions} from '$lib/analyze.ts';
import {throwOnDuplicates} from '$lib/analyze-core.ts';
import {byKind, errorsOf, hasErrors, hasWarnings, warningsOf} from '$lib/diagnostics.ts';
import type {SourceFileInfo} from '$lib/source.ts';
import {createSourceOptions} from '$lib/source-config.ts';
import {type DuplicateDeclaration} from '$lib/postprocess.ts';
import {ModuleJson} from '$lib/types.ts';

import {withTestProject} from './test-helpers.ts';

/**
 * Create source files from a project for analysis.
 */
const createSourceFiles = (
	projectRoot: string,
	files: Record<string, string>,
): Array<SourceFileInfo> => {
	return Object.entries(files)
		.filter(
			([path]) =>
				path.endsWith('.ts') ||
				path.endsWith('.svelte') ||
				path.endsWith('.css') ||
				path.endsWith('.json'),
		)
		.map(([path, content]) => ({
			id: join(projectRoot, path),
			content,
		}));
};

/**
 * Common setup for analyze tests: creates source files and options.
 */
const setupAnalysis = (projectRoot: string, files: Record<string, string>) => {
	const sourceFiles = createSourceFiles(projectRoot, files);
	const sourceOptions = createSourceOptions(projectRoot);
	return {sourceFiles, sourceOptions};
};

describe('analyze', {timeout: 15_000}, () => {
	describe('basic analysis', () => {
		test('analyzes TypeScript files and returns modules', async () => {
			const files = {
				'src/lib/math.ts': `
/**
 * Adds two numbers.
 * @param a First number
 * @param b Second number
 * @returns The sum
 */
export function add(a: number, b: number): number {
	return a + b;
}`,
				'src/lib/utils.ts': `export const VERSION = '1.0.0';`,
			};

			await withTestProject(files, async (projectRoot) => {
				const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);

				const {modules, diagnostics} = await analyze({
					sourceFiles,
					sourceOptions,
				});

				assert.strictEqual(modules.length, 2, 'Should have 2 modules');

				const mathModule = modules.find((m) => m.path === 'math.ts');
				assert.ok(mathModule, 'Should find math.ts module');
				assert.strictEqual(mathModule.declarations.length, 1, 'math.ts should have 1 declaration');

				const addFn = mathModule.declarations[0];
				assert.strictEqual(addFn?.name, 'add', 'Declaration should be named "add"');
				assert.strictEqual(addFn?.kind, 'function', 'Declaration should be a function');
				assert.strictEqual(addFn?.docComment, 'Adds two numbers.', 'Should extract doc comment');
				if (addFn?.kind !== 'function') throw new Error('expected function');
				assert.strictEqual(addFn.parameters.length, 2, 'Should have 2 parameters');
				assert.strictEqual(addFn.parameters[0]?.name, 'a');
				assert.strictEqual(addFn.parameters[0]?.type, 'number');
				assert.strictEqual(addFn.returnType, 'number', 'Should extract return type');
				assert.strictEqual(addFn.returnDescription, 'The sum', 'Should extract return description');

				// Check diagnostics
				const errors = errorsOf(diagnostics);
				assert.strictEqual(errors.length, 0, 'Should have no errors');
			});
		});

		test('analyzes Svelte components', async () => {
			const files = {
				'src/lib/Button.svelte': `<script lang="ts">
/** The button label */
let {label}: {label: string} = $props();
</script>
<button>{label}</button>`,
			};

			await withTestProject(files, async (projectRoot) => {
				const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);

				const {modules} = await analyze({
					sourceFiles,
					sourceOptions,
				});

				assert.strictEqual(modules.length, 1, 'Should have 1 module');

				const buttonModule = modules[0];
				assert.strictEqual(buttonModule?.path, 'Button.svelte', 'Path should be Button.svelte');

				const component = buttonModule?.declarations[0];
				assert.strictEqual(component?.name, 'Button', 'Component should be named Button');
				assert.strictEqual(component?.kind, 'component', 'Should be a component');
				if (component?.kind !== 'component') throw new Error('expected component');
				assert.ok(component.props, 'Should have props');
				assert.strictEqual(component.props.length, 1, 'Should have 1 prop');
				assert.strictEqual(component.props[0]?.name, 'label', 'Prop should be named label');
			});
		});

		test('returns modules sorted alphabetically by path', async () => {
			const files = {
				'src/lib/zebra.ts': 'export const zebra = 1;',
				'src/lib/alpha.ts': 'export const alpha = 2;',
				'src/lib/beta.ts': 'export const beta = 3;',
			};

			await withTestProject(files, async (projectRoot) => {
				const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);

				const {modules} = await analyze({
					sourceFiles,
					sourceOptions,
				});

				assert.strictEqual(modules[0]?.path, 'alpha.ts', 'First module should be alpha.ts');
				assert.strictEqual(modules[1]?.path, 'beta.ts', 'Second module should be beta.ts');
				assert.strictEqual(modules[2]?.path, 'zebra.ts', 'Third module should be zebra.ts');
			});
		});
	});

	describe('@nodocs filtering', () => {
		test('filters out declarations with @nodocs', async () => {
			const files = {
				'src/lib/helpers.ts': `
export const publicValue = 42;

/**
 * Internal helper excluded from documentation.
 * @nodocs
 */
export function internalHelper(): void {}

/** @nodocs */
export type InternalType = { secret: string };

export function public_function(): string {
	return 'public';
}`,
			};

			await withTestProject(files, async (projectRoot) => {
				const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);

				const {modules} = await analyze({
					sourceFiles,
					sourceOptions,
				});

				const helpersModule = modules.find((m) => m.path === 'helpers.ts');
				assert.ok(helpersModule, 'Should find helpers.ts module');

				// Should only have 2 declarations (nodocs filtered out)
				assert.strictEqual(
					helpersModule.declarations.length,
					2,
					'Should have 2 public declarations',
				);

				const names = helpersModule.declarations.map((d) => d.name).sort();
				assert.deepStrictEqual(names, ['publicValue', 'public_function'].sort());
			});
		});
	});

	describe('duplicate detection', () => {
		test("onDuplicates: 'throw' throws on duplicate names", async () => {
			const files = {
				'src/lib/foo.ts': 'export type Duplicate = { value: string };',
				'src/lib/bar.ts': 'export class Duplicate {}',
			};

			await withTestProject(files, async (projectRoot) => {
				const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);

				let errorThrown = false;
				let errorMessage = '';

				try {
					await analyze({
						sourceFiles,
						sourceOptions,
						onDuplicates: 'throw',
					});
				} catch (err: any) {
					errorThrown = true;
					errorMessage = err.message;
				}

				assert.ok(errorThrown, 'Should throw an error for duplicates');
				assert.ok(
					errorMessage.toLowerCase().includes('duplicate'),
					`Error message should mention duplicates, got: ${errorMessage}`,
				);
			});
		});

		test("onDuplicates: 'warn' logs to log.error and continues", async () => {
			const files = {
				'src/lib/foo.ts': 'export type Duplicate = { value: string };',
				'src/lib/bar.ts': 'export class Duplicate {}',
			};

			await withTestProject(files, async (projectRoot) => {
				const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);

				const errors: Array<string> = [];
				const log = {
					info: () => {},
					warn: () => {},
					error: (msg: string) => errors.push(msg),
				};

				const {modules} = await analyze({
					sourceFiles,
					sourceOptions,
					onDuplicates: 'warn',
					log,
				});

				assert.strictEqual(modules.length, 2, 'Should still produce both modules');
				assert.strictEqual(errors.length, 1, 'Should log exactly one duplicate error');
				assert.ok(
					errors[0]!.toLowerCase().includes('duplicate'),
					`Error message should mention duplicates, got: ${errors[0]}`,
				);
			});
		});

		test('does not throw without onDuplicates callback', async () => {
			const files = {
				'src/lib/foo.ts': 'export type Duplicate = { value: string };',
				'src/lib/bar.ts': 'export class Duplicate {}',
			};

			await withTestProject(files, async (projectRoot) => {
				const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);

				// Should not throw
				const {modules, diagnostics} = await analyze({
					sourceFiles,
					sourceOptions,
				});

				assert.strictEqual(modules.length, 2, 'Should analyze both modules');

				// Duplicates should still surface as a diagnostic even without onDuplicates
				const dupes = byKind(diagnostics, 'duplicate_declaration');
				assert.strictEqual(dupes.length, 1, 'Should emit one duplicate_declaration diagnostic');
				assert.strictEqual(dupes[0]!.declarationName, 'Duplicate');
				assert.deepStrictEqual(dupes[0]!.modules.slice().sort(), ['bar.ts', 'foo.ts']);
				assert.strictEqual(dupes[0]!.severity, 'warning');

				// Verify declarations are preserved (not silently dropped)
				const fooModule = modules.find((m) => m.path === 'foo.ts');
				const barModule = modules.find((m) => m.path === 'bar.ts');
				assert.ok(fooModule, 'Should find foo.ts');
				assert.ok(barModule, 'Should find bar.ts');
				assert.strictEqual(
					fooModule.declarations.length,
					1,
					'foo.ts should retain its declaration',
				);
				assert.strictEqual(
					barModule.declarations.length,
					1,
					'bar.ts should retain its declaration',
				);
			});
		});

		test('throwOnDuplicates callback throws like the "throw" shortcut', async () => {
			const files = {
				'src/lib/foo.ts': 'export type Duplicate = { value: string };',
				'src/lib/bar.ts': 'export class Duplicate {}',
			};

			await withTestProject(files, async (projectRoot) => {
				const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);

				let thrown: unknown;
				try {
					await analyze({
						sourceFiles,
						sourceOptions,
						onDuplicates: throwOnDuplicates,
					});
				} catch (err) {
					thrown = err;
				}

				assert.ok(thrown instanceof Error, 'should throw an Error');
				assert.match(thrown.message, /duplicate/i);
			});
		});

		test('throwOnDuplicates is a no-op when there are no duplicates', () => {
			// Direct call — bypasses analyze entirely so this stays focused on the helper.
			assert.doesNotThrow(() => throwOnDuplicates(new Map(), {error: () => {}}));
		});

		test('custom onDuplicates callback receives duplicate info', async () => {
			const files = {
				'src/lib/a.ts': 'export const Shared = 1;',
				'src/lib/b.ts': 'export const Shared = 2;',
				'src/lib/c.ts': 'export const Shared = 3;',
			};

			await withTestProject(files, async (projectRoot) => {
				const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);

				let receivedDuplicates: Map<string, Array<DuplicateDeclaration>> | null = null;

				await analyze({
					sourceFiles,
					sourceOptions,
					onDuplicates: (duplicates) => {
						receivedDuplicates = duplicates;
					},
				});

				assert.ok(receivedDuplicates, 'Callback should receive duplicates');
				// Type narrowing: receivedDuplicates is now known to be non-null
				const duplicates = receivedDuplicates as Map<string, Array<DuplicateDeclaration>>;
				assert.strictEqual(duplicates.size, 1, 'Should have 1 duplicate name');
				assert.ok(duplicates.has('Shared'), 'Should have "Shared" as duplicate');

				const occurrences = duplicates.get('Shared')!;
				assert.strictEqual(occurrences.length, 3, 'Should have 3 occurrences');
			});
		});
	});

	describe('dependency computation', () => {
		test('computes bidirectional dependencies from provided dependencies', async () => {
			const files = {
				'src/lib/math.ts': 'export const add = (a: number, b: number) => a + b;',
				'src/lib/utils.ts': `import {add} from './math.js';\nexport const sum = add(1, 2);`,
			};

			await withTestProject(files, async (projectRoot) => {
				// Create source files with dependencies already computed
				const sourceFiles: Array<SourceFileInfo> = [
					{
						id: join(projectRoot, 'src/lib/math.ts'),
						content: files['src/lib/math.ts'],
						// No dependencies initially
					},
					{
						id: join(projectRoot, 'src/lib/utils.ts'),
						content: files['src/lib/utils.ts'],
						dependencies: [join(projectRoot, 'src/lib/math.ts')],
					},
				];

				const sourceOptions = createSourceOptions(projectRoot);

				const {modules} = await analyze({
					sourceFiles,
					sourceOptions,
				});

				const mathModule = modules.find((m) => m.path === 'math.ts');
				const utilsModule = modules.find((m) => m.path === 'utils.ts');

				// utils depends on math
				assert.deepStrictEqual(utilsModule?.dependencies, ['math.ts']);

				// math should have utils as dependent (computed from dependencies)
				assert.deepStrictEqual(mathModule?.dependents, ['utils.ts']);
			});
		});
	});

	describe('re-export resolution', () => {
		test('merges re-exports into alsoExportedFrom', async () => {
			const files = {
				'src/lib/helpers.ts': `
/** A helper function. */
export function helper(): void {}

export const CONSTANT = 42;`,
				'src/lib/index.ts': `
// Re-export from helpers
export {helper, CONSTANT} from './helpers.js';

// Direct export
export const localValue = 'local';`,
			};

			await withTestProject(files, async (projectRoot) => {
				const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);

				const {modules} = await analyze({
					sourceFiles,
					sourceOptions,
				});

				const helpersModule = modules.find((m) => m.path === 'helpers.ts');
				assert.ok(helpersModule, 'Should find helpers.ts');

				const helperDecl = helpersModule.declarations.find((d) => d.name === 'helper');
				assert.ok(helperDecl, 'Should find helper declaration');

				// helper should be marked as also exported from index.ts
				assert.ok(helperDecl.alsoExportedFrom, 'helper should have alsoExportedFrom');
				assert.ok(
					helperDecl.alsoExportedFrom.includes('index.ts'),
					'helper should be also exported from index.ts',
				);
			});
		});
	});

	describe('renamed re-exports', () => {
		test('creates aliasOf for renamed re-exports', async () => {
			const files = {
				'src/lib/helpers.ts': `
export function originalName(): void {}`,
				'src/lib/index.ts': `
export {originalName as aliasedName} from './helpers.js';`,
			};

			await withTestProject(files, async (projectRoot) => {
				const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);

				const {modules} = await analyze({
					sourceFiles,
					sourceOptions,
				});

				const indexModule = modules.find((m) => m.path === 'index.ts');
				assert.ok(indexModule, 'Should find index.ts');

				const aliasDecl = indexModule.declarations.find((d) => d.name === 'aliasedName');
				assert.ok(aliasDecl, 'Should find aliasedName declaration');
				assert.ok(aliasDecl.aliasOf, 'Should have aliasOf');
				assert.strictEqual(aliasDecl.aliasOf.name, 'originalName');
				assert.strictEqual(aliasDecl.aliasOf.module, 'helpers.ts');

				// Verify canonical declaration is not affected (renamed, not same-name re-exported)
				const helpersModule = modules.find((m) => m.path === 'helpers.ts');
				assert.ok(helpersModule, 'Should find helpers.ts');
				const originalDecl = helpersModule.declarations.find((d) => d.name === 'originalName');
				assert.ok(originalDecl, 'Should find originalName');
				assert.deepStrictEqual(
					originalDecl.alsoExportedFrom,
					[],
					'Canonical declaration should not have alsoExportedFrom for a rename',
				);
			});
		});

		test('renamed re-exports inherit rich fields from the canonical declaration', async () => {
			const files = {
				'src/lib/helpers.ts': `
declare function $state<T>(v: T): T;
/** Adds two numbers. */
export function originalFn(a: number, b: number): number { return a + b; }
/** A counter. */
export let originalCount = $state(0);`,
				'src/lib/index.ts': `
export {originalFn as renamedFn, originalCount as renamedCount} from './helpers.js';`,
			};

			await withTestProject(files, async (projectRoot) => {
				const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
				const {modules} = await analyze({sourceFiles, sourceOptions});

				const indexModule = modules.find((m) => m.path === 'index.ts');
				assert.ok(indexModule, 'Should find index.ts');

				const renamedFn = indexModule.declarations.find((d) => d.name === 'renamedFn');
				assert.ok(renamedFn && renamedFn.kind === 'function', 'renamedFn should be a function');
				assert.ok(renamedFn.aliasOf, 'renamedFn should carry aliasOf');
				assert.strictEqual(renamedFn.aliasOf.name, 'originalFn');
				assert.strictEqual(renamedFn.aliasOf.module, 'helpers.ts');
				assert.strictEqual(renamedFn.docComment, 'Adds two numbers.');
				assert.ok(renamedFn.typeSignature, 'should have typeSignature');
				assert.strictEqual(renamedFn.parameters.length, 2);
				assert.strictEqual(renamedFn.parameters[0]?.name, 'a');
				assert.strictEqual(renamedFn.returnType, 'number');
				assert.strictEqual(
					renamedFn.sourceLine,
					2,
					'synthesized alias points at the local export specifier, not the canonical',
				);

				const renamedCount = indexModule.declarations.find((d) => d.name === 'renamedCount');
				assert.ok(
					renamedCount && renamedCount.kind === 'variable',
					'renamedCount should be a variable',
				);
				assert.strictEqual(renamedCount.reactivity, '$state');
				assert.strictEqual(renamedCount.docComment, 'A counter.');
				assert.ok(renamedCount.typeSignature, 'should have typeSignature');
				assert.strictEqual(renamedCount.sourceLine, 2);
				assert.ok(renamedCount.aliasOf);
				assert.strictEqual(renamedCount.aliasOf.name, 'originalCount');
			});
		});

		describe('reactivity propagation', () => {
			test('same-name re-export of a rune declaration keeps reactivity on the canonical', async () => {
				const files = {
					'src/lib/counter.ts': `
declare function $state<T>(v: T): T;
export let count = $state(0);`,
					'src/lib/index.ts': `
export {count} from './counter.js';`,
				};

				await withTestProject(files, async (projectRoot) => {
					const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
					const {modules} = await analyze({sourceFiles, sourceOptions});

					const counter = modules.find((m) => m.path === 'counter.ts');
					const canonical = counter?.declarations.find((d) => d.name === 'count');
					assert.ok(canonical && canonical.kind === 'variable');
					assert.strictEqual(canonical.reactivity, '$state');
					assert.deepStrictEqual(canonical.alsoExportedFrom, ['index.ts']);

					// The re-exporting module shouldn't have its own copy of the declaration —
					// it lives canonically in counter.ts and the re-export is captured via
					// `alsoExportedFrom` above.
					const indexModule = modules.find((m) => m.path === 'index.ts');
					assert.strictEqual(
						indexModule?.declarations.find((d) => d.name === 'count'),
						undefined,
					);
				});
			});
		});
	});

	describe('edge cases', () => {
		test('handles files with only non-exported declarations', async () => {
			const files = {
				'src/lib/internal.ts': `
const privateConst = 42;
function privateHelper(): void {}
class PrivateClass {}`,
			};

			await withTestProject(files, async (projectRoot) => {
				const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);

				const {modules} = await analyze({
					sourceFiles,
					sourceOptions,
				});

				const internalModule = modules.find((m) => m.path === 'internal.ts');
				assert.ok(internalModule, 'Should find internal.ts');
				assert.deepStrictEqual(internalModule.declarations, []);
			});
		});

		test('normalizes un-normalized sourceOptions before program creation', async () => {
			// Validates `normalizeSourceOptions` runs before the TypeScript program is
			// created, so trailing slashes / un-normalized `projectRoot` produce the
			// same output as the canonical absolute form.
			const files = {
				'src/lib/foo.ts': `export const VALUE = 42;`,
			};

			await withTestProject(files, async (projectRoot) => {
				const sourceFiles = createSourceFiles(projectRoot, files);

				const canonical = await analyze({
					sourceFiles,
					sourceOptions: createSourceOptions(projectRoot),
				});

				const denormalized = await analyze({
					sourceFiles,
					sourceOptions: createSourceOptions(projectRoot + '/', {
						sourcePaths: ['/src/lib/'],
					}),
				});

				assert.deepStrictEqual(
					denormalized.modules,
					canonical.modules,
					'un-normalized sourceOptions should produce identical output',
				);
			});
		});

		test('handles mixed documented and undocumented declarations', async () => {
			const files = {
				'src/lib/mixed.ts': `
/** Documented function. */
export function documented(): void {}

export function undocumented(): void {}

/** Documented variable. */
export const docVar = 1;

export const undocVar = 2;`,
			};

			await withTestProject(files, async (projectRoot) => {
				const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);

				const {modules} = await analyze({
					sourceFiles,
					sourceOptions,
				});

				const mixedModule = modules.find((m) => m.path === 'mixed.ts');
				assert.ok(mixedModule, 'Should find mixed.ts');
				assert.strictEqual(mixedModule.declarations.length, 4);

				const documented = mixedModule.declarations.find((d) => d.name === 'documented');
				const undocumented = mixedModule.declarations.find((d) => d.name === 'undocumented');
				const docVar = mixedModule.declarations.find((d) => d.name === 'docVar');
				const undocVar = mixedModule.declarations.find((d) => d.name === 'undocVar');

				assert.strictEqual(documented?.docComment, 'Documented function.');
				assert.ok(!undocumented?.docComment);
				assert.strictEqual(docVar?.docComment, 'Documented variable.');
				assert.ok(!undocVar?.docComment);
			});
		});
	});

	describe('logger integration', () => {
		test('reports diagnostics via provided logger', async () => {
			const files = {
				'src/lib/valid.ts': 'export const value = 42;',
			};

			await withTestProject(files, async (projectRoot) => {
				const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);

				const logCalls: Array<{level: string; args: Array<unknown>}> = [];
				const mockLog = {
					info: (...args: Array<unknown>) => logCalls.push({level: 'info', args}),
					warn: (...args: Array<unknown>) => logCalls.push({level: 'warn', args}),
					error: (...args: Array<unknown>) => logCalls.push({level: 'error', args}),
				};

				await analyze({
					sourceFiles,
					sourceOptions,
					log: mockLog as any,
				});

				// Valid code should produce no error/warn log calls
				const errorCalls = logCalls.filter((c) => c.level === 'error');
				const warnCalls = logCalls.filter((c) => c.level === 'warn');
				assert.strictEqual(errorCalls.length, 0, 'Should have no error logs');
				assert.strictEqual(warnCalls.length, 0, 'Should have no warn logs');
			});
		});
	});

	describe('determinism', () => {
		test('produces identical output on repeated calls', async () => {
			const files = {
				'src/lib/c.ts': 'export const c = 1;',
				'src/lib/a.ts': 'export const a = 2;',
				'src/lib/b.ts': 'export const b = 3;',
			};

			await withTestProject(files, async (projectRoot) => {
				const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);

				const options: AnalyzeOptions = {
					sourceFiles,
					sourceOptions,
				};

				const result1 = await analyze(options);
				const result2 = await analyze(options);

				// Compare serialized output for exact equality
				const json1 = JSON.stringify(result1.modules);
				const json2 = JSON.stringify(result2.modules);

				assert.strictEqual(json1, json2, 'Repeated calls should produce identical output');
			});
		});

		test('module order is deterministic regardless of input order', async () => {
			await withTestProject(
				{
					'src/lib/z.ts': 'export const z = 1;',
					'src/lib/a.ts': 'export const a = 2;',
					'src/lib/m.ts': 'export const m = 3;',
				},
				async (projectRoot) => {
					const sourceOptions = createSourceOptions(projectRoot);

					// Different input orders
					const sourceFilesOrder1: Array<SourceFileInfo> = [
						{id: join(projectRoot, 'src/lib/z.ts'), content: 'export const z = 1;'},
						{id: join(projectRoot, 'src/lib/a.ts'), content: 'export const a = 2;'},
						{id: join(projectRoot, 'src/lib/m.ts'), content: 'export const m = 3;'},
					];

					const sourceFilesOrder2: Array<SourceFileInfo> = [
						{id: join(projectRoot, 'src/lib/a.ts'), content: 'export const a = 2;'},
						{id: join(projectRoot, 'src/lib/m.ts'), content: 'export const m = 3;'},
						{id: join(projectRoot, 'src/lib/z.ts'), content: 'export const z = 1;'},
					];

					const result1 = await analyze({
						sourceFiles: sourceFilesOrder1,
						sourceOptions,
					});
					const result2 = await analyze({
						sourceFiles: sourceFilesOrder2,
						sourceOptions,
					});

					const paths1 = result1.modules.map((m) => m.path);
					const paths2 = result2.modules.map((m) => m.path);

					assert.deepStrictEqual(paths1, paths2, 'Module order should be deterministic');
					assert.deepStrictEqual(
						paths1,
						['a.ts', 'm.ts', 'z.ts'],
						'Should be alphabetically sorted',
					);
				},
			);
		});
	});

	describe('module comment extraction', () => {
		test('extracts module-level JSDoc comments', async () => {
			const files = {
				'src/lib/documented.ts': `
/**
 * This module provides math utilities.
 *
 * @module
 */

export const add = (a: number, b: number) => a + b;`,
			};

			await withTestProject(files, async (projectRoot) => {
				const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);

				const {modules} = await analyze({
					sourceFiles,
					sourceOptions,
				});

				const documentedModule = modules.find((m) => m.path === 'documented.ts');
				assert.ok(documentedModule, 'Should find documented.ts');
				assert.ok(documentedModule.moduleComment, 'Should have moduleComment');
				assert.strictEqual(documentedModule.moduleComment, 'This module provides math utilities.');
			});
		});
	});

	describe('JSON file support', () => {
		test('includes JSON files in analysis output', async () => {
			const files = {
				'src/lib/config.json': '{"debug": true}',
				'src/lib/utils.ts': `export const VERSION = '1.0.0';`,
			};

			await withTestProject(files, async (projectRoot) => {
				const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);

				const {modules} = await analyze({
					sourceFiles,
					sourceOptions,
				});

				assert.strictEqual(modules.length, 2, 'Should have 2 modules');

				const jsonModule = modules.find((m) => m.path === 'config.json');
				assert.ok(jsonModule, 'Should find config.json module');
				assert.deepStrictEqual(jsonModule.declarations, [], 'JSON module has no declarations');
			});
		});

		test('JSON files appear in dependency graphs', async () => {
			const files = {
				'src/lib/data.json': '{"items": [1, 2, 3]}',
				'src/lib/loader.ts': `import data from './data.json';\nexport const items = data.items;`,
			};

			await withTestProject(files, async (projectRoot) => {
				// Create source files with dependencies already computed
				const sourceFiles: Array<SourceFileInfo> = [
					{
						id: join(projectRoot, 'src/lib/data.json'),
						content: files['src/lib/data.json'],
					},
					{
						id: join(projectRoot, 'src/lib/loader.ts'),
						content: files['src/lib/loader.ts'],
						dependencies: [join(projectRoot, 'src/lib/data.json')],
					},
				];

				const sourceOptions = createSourceOptions(projectRoot);

				const {modules} = await analyze({
					sourceFiles,
					sourceOptions,
				});

				const loaderModule = modules.find((m) => m.path === 'loader.ts');
				const dataModule = modules.find((m) => m.path === 'data.json');

				// loader depends on data.json
				assert.ok(loaderModule?.dependencies, 'loader.ts should have dependencies');
				assert.ok(
					loaderModule.dependencies.includes('data.json'),
					'loader.ts should depend on data.json',
				);

				// data.json should have loader as dependent (computed)
				assert.ok(dataModule?.dependents, 'data.json should have dependents');
				assert.ok(
					dataModule.dependents.includes('loader.ts'),
					'data.json should have loader.ts as dependent',
				);
			});
		});
	});

	describe('star exports tracking', () => {
		test('tracks star exports in module metadata', async () => {
			const files = {
				'src/lib/utils.ts': `
export const foo = 1;
export const bar = 2;`,
				'src/lib/index.ts': `
export * from './utils.js';
export const local = 'value';`,
			};

			await withTestProject(files, async (projectRoot) => {
				const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);

				const {modules} = await analyze({
					sourceFiles,
					sourceOptions,
				});

				const indexModule = modules.find((m) => m.path === 'index.ts');
				assert.ok(indexModule, 'Should find index.ts');
				assert.ok(indexModule.starExports, 'index.ts should have starExports');
				assert.ok(
					indexModule.starExports.includes('utils.ts'),
					'starExports should include utils.ts',
				);

				// Star exports are module-level metadata only — they do NOT populate
				// per-declaration alsoExportedFrom (unlike named re-exports).
				// Consumers follow starExports chains to resolve the full set.
				const utilsModule = modules.find((m) => m.path === 'utils.ts');
				assert.ok(utilsModule, 'Should find utils.ts');
				const fooDecl = utilsModule.declarations.find((d) => d.name === 'foo');
				assert.ok(fooDecl, 'Should find foo declaration');
				assert.deepStrictEqual(
					fooDecl.alsoExportedFrom,
					[],
					'Star exports do not populate alsoExportedFrom',
				);
			});
		});
	});

	describe('edge cases', () => {
		test('handles empty sourceFiles array without error', async () => {
			const files = {
				'src/lib/foo.ts': 'export const foo = 1;',
			};

			await withTestProject(files, async (projectRoot) => {
				const sourceOptions = createSourceOptions(projectRoot);

				const {modules, diagnostics} = await analyze({
					sourceFiles: [],
					sourceOptions,
				});

				assert.strictEqual(modules.length, 0, 'Empty sourceFiles should produce no modules');
				assert.strictEqual(hasErrors(diagnostics), false, 'Should have no errors');
			});
		});

		test('creates program internally from sourceOptions.projectRoot', async () => {
			const files = {
				'src/lib/bar.ts': 'export const bar = 42;',
			};

			await withTestProject(files, async (projectRoot) => {
				const sourceFiles = createSourceFiles(projectRoot, files);

				const {modules} = await analyze({
					sourceFiles,
					sourceOptions: createSourceOptions(projectRoot),
				});

				assert.strictEqual(modules.length, 1);
				assert.strictEqual(modules[0]?.path, 'bar.ts');
			});
		});
	});

	describe('CSS file support', () => {
		test('includes CSS files in analysis output', async () => {
			const files = {
				'src/lib/theme.css': ':root { --color: red; }',
				'src/lib/utils.ts': `export const VERSION = '1.0.0';`,
			};

			await withTestProject(files, async (projectRoot) => {
				const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);

				const {modules} = await analyze({
					sourceFiles,
					sourceOptions,
				});

				assert.strictEqual(modules.length, 2, 'Should have 2 modules');

				const cssModule = modules.find((m) => m.path === 'theme.css');
				assert.ok(cssModule, 'Should find theme.css module');
				assert.deepStrictEqual(cssModule.declarations, [], 'CSS module has no declarations');
			});
		});
	});

	describe('JSON round-trip', () => {
		// Primary lock-in for the full `await analyze() → JSON.stringify → JSON.parse`
		// pipeline. Sibling tests in `diagnostics.test.ts > JSON round-trip` cover
		// the diagnostics container in isolation and `declaration-helpers.test.ts >
		// compactReplacer` covers the modules array; this test asserts the
		// combined `AnalyzeResultJson` shape survives end-to-end with both halves
		// usable post-parse.
		test('analyze result survives JSON.stringify → JSON.parse with diagnostics and modules intact', async () => {
			const files = {
				'src/lib/math.ts': `
/** Adds two numbers. */
export function add(a: number, b: number): number { return a + b; }
/** A sentinel value. */
export const ANSWER = 42;
/** A point in 2D space. */
export interface Point { x: number; y: number; }`,
			};

			await withTestProject(files, async (projectRoot) => {
				const {sourceFiles, sourceOptions} = setupAnalysis(projectRoot, files);
				const result = await analyze({sourceFiles, sourceOptions});

				const parsed = JSON.parse(JSON.stringify(result)) as typeof result;

				// `diagnostics` is a bare `Array<Diagnostic>` after the wrapper-flattening
				// refactor. The regression vector this guards is class → plain data:
				// methods would not survive `JSON.parse`.
				assert.ok(Array.isArray(parsed.diagnostics), 'diagnostics must be an array post-parse');

				// Free helpers behave identically against parsed and original diagnostics.
				assert.strictEqual(hasErrors(parsed.diagnostics), hasErrors(result.diagnostics));
				assert.strictEqual(hasWarnings(parsed.diagnostics), hasWarnings(result.diagnostics));
				assert.deepStrictEqual(errorsOf(parsed.diagnostics), errorsOf(result.diagnostics));
				assert.deepStrictEqual(warningsOf(parsed.diagnostics), warningsOf(result.diagnostics));

				// Every parsed module passes Zod validation — locks in that the
				// modules half of the wire format round-trips faithfully alongside diagnostics.
				assert.strictEqual(parsed.modules.length, 1);
				for (const m of parsed.modules) {
					assert.doesNotThrow(() => ModuleJson.parse(m));
				}

				// And the canonical declaration is recoverable from the parsed module.
				const math = parsed.modules.find((m) => m.path === 'math.ts');
				assert.ok(math, 'should find math.ts');
				assert.strictEqual(math.declarations.length, 3);
			});
		});
	});
});
