/**
 * Tests for high-level fromFiles API (fromFiles.ts).
 *
 * These are integration tests covering the full pipeline from file discovery to analysis.
 */

import {test, assert, describe} from 'vitest';

import {analyzeFromFiles} from '$lib/analyze.js';
import {errorsOf} from '$lib/diagnostics.js';

import {
	createTestProject,
	findModule,
	assertHasDependency,
	assertHasDependent,
	assertHasDeclaration,
	assertHasComponentDeclaration,
	assertHasParameters,
	assertHasProps,
} from './test-helpers.js';

describe('analyzeFromFiles', {timeout: 15_000}, () => {
	describe('basic functionality', () => {
		test('analyzes simple TypeScript library', async () => {
			const {projectRoot, cleanup} = await createTestProject({
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
			});

			try {
				const {modules, diagnostics} = await analyzeFromFiles({
					projectRoot,
				});

				// Should have 2 modules
				assert.strictEqual(modules.length, 2);

				// Find math module
				const mathModule = findModule(modules, 'math.ts');
				assert.strictEqual(mathModule.declarations.length, 1);

				const addFn = assertHasDeclaration(mathModule, 'add');
				assert.strictEqual(addFn.kind, 'function');
				assert.strictEqual(addFn.docComment, 'Adds two numbers.');
				if (addFn.kind !== 'function') throw new Error('expected function');
				assertHasParameters(addFn, ['a', 'b']);

				// Should have no errors
				const errors = errorsOf(diagnostics);
				assert.strictEqual(errors.length, 0);
			} finally {
				await cleanup();
			}
		});

		test('analyzes Svelte component library', async () => {
			const {projectRoot, cleanup} = await createTestProject({
				'src/lib/Button.svelte': `<script lang="ts">
/** The button label */
let {label}: {label: string} = $props();
</script>
<button>{label}</button>`,
				'src/lib/Card.svelte': `<script lang="ts">
let {title}: {title: string} = $props();
</script>
<div class="card">{title}</div>`,
			});

			try {
				const {modules} = await analyzeFromFiles({
					projectRoot,
				});

				assert.strictEqual(modules.length, 2);

				// Find Button component
				const buttonModule = findModule(modules, 'Button.svelte');
				assert.strictEqual(buttonModule.declarations.length, 1);

				const button = assertHasComponentDeclaration(buttonModule, 'Button');
				assertHasProps(button, ['label']);
			} finally {
				await cleanup();
			}
		});

		test('analyzes mixed TypeScript and Svelte library', async () => {
			const {projectRoot, cleanup} = await createTestProject({
				'src/lib/types.ts': `export type Config = {name: string};`,
				'src/lib/utils.ts': `export const helper = () => 'test';`,
				'src/lib/Button.svelte': `<script lang="ts">
let {label}: {label: string} = $props();
</script>
<button>{label}</button>`,
			});

			try {
				const {modules} = await analyzeFromFiles({
					projectRoot,
				});

				assert.strictEqual(modules.length, 3);

				const types = modules.some((m) => m.path === 'types.ts');
				const utils = modules.some((m) => m.path === 'utils.ts');
				const button = modules.some((m) => m.path === 'Button.svelte');

				assert.ok(types, 'Should find types.ts module');
				assert.ok(utils, 'Should find utils.ts module');
				assert.ok(button, 'Should find Button.svelte module');
			} finally {
				await cleanup();
			}
		});
	});

	describe('options', () => {
		test('uses custom include patterns', async () => {
			const {projectRoot, cleanup} = await createTestProject({
				'src/lib/foo.ts': 'export const foo = 1;',
				'src/lib/nested/Button.svelte':
					'<script lang="ts">let {label}: {label: string} = $props();</script><button>{label}</button>',
			});

			try {
				// Only include nested directory within src/lib
				const {modules} = await analyzeFromFiles({
					projectRoot,
					include: ['src/lib/nested/**/*.svelte'],
				});

				assert.strictEqual(modules.length, 1);
				assert.strictEqual(modules[0]!.path, 'nested/Button.svelte');
			} finally {
				await cleanup();
			}
		});

		test('discovers files in custom sourcePaths without an explicit include (glob fallback)', async () => {
			// Regression: prior to deriving include from sourcePaths inside
			// discoverSourceFiles, this combination silently fell back to the
			// hardcoded `src/lib/**/*.{...}` default and discovered zero files.
			// Only `discoverFromExports` was sourcePaths-aware; the glob fallback
			// wasn't. The CLI compensated locally with its own derivation; the
			// API didn't, so build-tool integrations driving `analyzeFromFiles`
			// with custom `sourcePaths` got an empty result.
			const {projectRoot, cleanup} = await createTestProject({
				'packages/foo/library.ts': 'export const foo = 1;',
				'packages/foo/utils.ts': 'export const bar = 2;',
				'src/lib/should-not-appear.ts': 'export const irrelevant = 3;',
			});

			try {
				const {modules} = await analyzeFromFiles({
					projectRoot,
					sourceOptions: {sourcePaths: ['packages/foo']},
					// No `include` — glob fallback should derive from sourcePaths.
					discovery: 'glob',
				});

				assert.strictEqual(modules.length, 2, 'Should discover both files in packages/foo');
				const paths = modules.map((m) => m.path).sort();
				assert.deepStrictEqual(paths, ['library.ts', 'utils.ts']);
				assert.ok(
					!modules.some((m) => m.path.includes('should-not-appear')),
					'Should NOT pull in files from the default src/lib path',
				);
			} finally {
				await cleanup();
			}
		});

		test('uses exclude patterns', async () => {
			const {projectRoot, cleanup} = await createTestProject({
				'src/lib/foo.ts': 'export const foo = 1;',
				'src/lib/foo.test.ts': 'test("foo", () => {});',
				'src/lib/bar.ts': 'export const bar = 2;',
			});

			try {
				const {modules} = await analyzeFromFiles({
					projectRoot,
					exclude: ['**/*.test.ts'],
				});

				assert.strictEqual(modules.length, 2, 'Should exclude test file');
				assert.ok(
					!modules.some((m) => m.path.includes('.test')),
					'No module should have .test in path',
				);
			} finally {
				await cleanup();
			}
		});

		test('applies default exclude globs at discovery when no exclude provided', async () => {
			// Without explicit exclude, **/*.test.ts and **/*.spec.ts should be filtered
			// at discovery time (not just analysis time) — verifies defaulting at both
			// the exports-based and glob-based call sites.
			const {projectRoot, cleanup} = await createTestProject({
				'src/lib/foo.ts': 'export const foo = 1;',
				'src/lib/foo.test.ts': 'test("foo", () => {});',
				'src/lib/bar.spec.ts': 'test("bar", () => {});',
				'src/lib/baz.ts': 'export const baz = 2;',
			});

			try {
				// Glob path (no package.json exports field)
				const {modules: globModules} = await analyzeFromFiles({
					projectRoot,
					discovery: 'glob',
				});

				assert.strictEqual(globModules.length, 2, 'glob path: defaults exclude .test/.spec');
				assert.ok(
					!globModules.some((m) => m.path.includes('.test') || m.path.includes('.spec')),
					'glob path: no .test/.spec module',
				);
			} finally {
				await cleanup();
			}

			// Exports path: a wildcard export that would otherwise pick up the test files
			const exportsProject = await createTestProject({
				'src/lib/foo.ts': 'export const foo = 1;',
				'src/lib/foo.test.ts': 'test("foo", () => {});',
				'src/lib/bar.spec.ts': 'test("bar", () => {});',
				'package.json': JSON.stringify({
					name: 'test-pkg',
					exports: {
						'./*': './dist/*.js',
					},
				}),
			});

			try {
				const {modules: exportModules} = await analyzeFromFiles({
					projectRoot: exportsProject.projectRoot,
				});

				assert.ok(
					!exportModules.some((m) => m.path.includes('.test') || m.path.includes('.spec')),
					'exports path: no .test/.spec module',
				);
			} finally {
				await exportsProject.cleanup();
			}
		});

		test('top-level exclude filters files reaching the dep graph via import resolution', async () => {
			// The motivating scenario for unifying exclude into a single glob applied
			// at both discovery and analysis: a custom exclude pattern (`**/*.internal.ts`)
			// should filter at BOTH stages. Without analysis-time enforcement, an in-source
			// file importing an `.internal.ts` helper would drag the helper into
			// `dependencies` even though the user excluded it.
			const {projectRoot, cleanup} = await createTestProject({
				'src/lib/public.ts': `
import {secret} from './helpers.internal.js';
export const exposed = secret + 1;`,
				'src/lib/helpers.internal.ts': 'export const secret = 42;',
			});

			try {
				const {modules} = await analyzeFromFiles({
					projectRoot,
					exclude: ['**/*.internal.ts'],
				});

				assert.strictEqual(modules.length, 1, 'Only public.ts is a module');
				const publicMod = findModule(modules, 'public.ts');
				assert.deepStrictEqual(
					publicMod.dependencies,
					[],
					'helpers.internal.ts must not appear in the dep graph',
				);
				assert.ok(!modules.some((m) => m.path.includes('.internal.ts')), 'No .internal.ts module');
			} finally {
				await cleanup();
			}
		});

		test('resolves dependencies when resolveDependencies: true', async () => {
			const {projectRoot, cleanup} = await createTestProject({
				'src/lib/math.ts': 'export const add = (a: number, b: number) => a + b;',
				'src/lib/utils.ts': `import {add} from './math.js';\nexport const sum = add(1, 2);`,
			});

			try {
				const {modules} = await analyzeFromFiles({
					projectRoot,
					resolveDependencies: true,
				});

				const utils = findModule(modules, 'utils.ts');
				const math = findModule(modules, 'math.ts');

				// utils depends on math
				assertHasDependency(utils, 'math.ts');

				// math is depended upon by utils
				assertHasDependent(math, 'utils.ts');
			} finally {
				await cleanup();
			}
		});

		test('skips dependency resolution when resolveDependencies: false', async () => {
			const {projectRoot, cleanup} = await createTestProject({
				'src/lib/math.ts': 'export const add = (a: number, b: number) => a + b;',
				'src/lib/utils.ts': `import {add} from './math.js';\nexport const sum = add(1, 2);`,
			});

			try {
				const {modules} = await analyzeFromFiles({
					projectRoot,
					resolveDependencies: false,
				});

				// Dependencies should be empty (not populated)
				for (const module of modules) {
					assert.deepStrictEqual(module.dependencies, []);
					assert.deepStrictEqual(module.dependents, []);
				}
			} finally {
				await cleanup();
			}
		});
	});

	describe('duplicate handling', () => {
		test('detects duplicates without throwing by default', async () => {
			const {projectRoot, cleanup} = await createTestProject({
				'src/lib/foo.ts': 'export type Duplicate = {value: string};',
				'src/lib/bar.ts': 'export class Duplicate {}',
			});

			try {
				// Should not throw by default
				const {modules} = await analyzeFromFiles({
					projectRoot,
				});

				assert.strictEqual(modules.length, 2);
			} finally {
				await cleanup();
			}
		});

		test("throws on duplicates with onDuplicates: 'throw'", async () => {
			const {projectRoot, cleanup} = await createTestProject({
				'src/lib/foo.ts': 'export type Duplicate = {value: string};',
				'src/lib/bar.ts': 'export class Duplicate {}',
			});

			try {
				// Expect the function to throw when duplicates are found
				let errorThrown = false;
				let errorMessage = '';
				try {
					await analyzeFromFiles({
						projectRoot,
						onDuplicates: 'throw',
					});
				} catch (err: any) {
					errorThrown = true;
					errorMessage = err.message;
				}
				assert.ok(errorThrown, 'Expected analyzeFromFiles to throw for duplicates');
				// Verify error message mentions duplicates (exact wording may vary)
				assert.ok(
					errorMessage.toLowerCase().includes('duplicate'),
					`Expected error message to mention duplicates, got: ${errorMessage}`,
				);
			} finally {
				await cleanup();
			}
		});
	});

	describe('error handling', () => {
		test('continues analysis with invalid syntax in one file', async () => {
			const {projectRoot, cleanup} = await createTestProject({
				'src/lib/valid.ts': 'export const valid = 1;',
				'src/lib/malformed.ts': 'export const broken = {{{', // Invalid syntax
			});

			try {
				const {modules, diagnostics} = await analyzeFromFiles({
					projectRoot,
				});

				// Valid file should still be analyzed
				const validModule = modules.find((m) => m.path === 'valid.ts');
				assert.ok(validModule, 'Valid file should be analyzed despite malformed sibling');

				// Malformed file might be skipped or have degraded analysis
				// We don't guarantee what happens, just that it doesn't crash
				assert.ok(modules.length >= 1, 'Should have at least one module analyzed');

				// Should collect diagnostics (array exists, possibly empty)
				assert.ok(Array.isArray(diagnostics), 'diagnostics should be an array');

				// Lock in the file-path contract: every diagnostic's `file` is
				// project-root-relative — no leading slash, no `./` prefix, and
				// no `projectRoot` prefix. `resolveDependencies` writes absolute
				// `file.id` paths internally; the post-pass in `analyzeFromFiles`
				// must normalize them before returning.
				for (const d of diagnostics) {
					assert.ok(!d.file.startsWith('/'), `diagnostic file should not be absolute: ${d.file}`);
					assert.ok(
						!d.file.startsWith('./'),
						`diagnostic file should not have ./ prefix: ${d.file}`,
					);
					assert.ok(
						!d.file.startsWith(projectRoot),
						`diagnostic file should not include projectRoot: ${d.file}`,
					);
				}
			} finally {
				await cleanup();
			}
		});

		test('handles empty library gracefully', async () => {
			const {projectRoot, cleanup} = await createTestProject({
				// No source files, only config
			});

			try {
				const {modules, diagnostics} = await analyzeFromFiles({
					projectRoot,
				});

				assert.strictEqual(modules.length, 0, 'Empty library should have no modules');
				// May have diagnostics but should not error
				assert.ok(Array.isArray(diagnostics), 'diagnostics should be an array');
			} finally {
				await cleanup();
			}
		});
	});

	describe('module sorting and determinism', () => {
		test('returns modules sorted alphabetically by path', async () => {
			const {projectRoot, cleanup} = await createTestProject({
				'src/lib/zebra.ts': 'export const zebra = 1;',
				'src/lib/alpha.ts': 'export const alpha = 2;',
				'src/lib/beta.ts': 'export const beta = 3;',
			});

			try {
				const {modules} = await analyzeFromFiles({
					projectRoot,
				});

				assert.strictEqual(modules[0]!.path, 'alpha.ts');
				assert.strictEqual(modules[1]!.path, 'beta.ts');
				assert.strictEqual(modules[2]!.path, 'zebra.ts');
			} finally {
				await cleanup();
			}
		});

		test('produces deterministic output on multiple calls', async () => {
			const {projectRoot, cleanup} = await createTestProject({
				'src/lib/c.ts': 'export const c = 1;',
				'src/lib/a.ts': 'export const a = 2;',
				'src/lib/b.ts': 'export const b = 3;',
			});

			try {
				const result1 = await analyzeFromFiles({projectRoot});
				const result2 = await analyzeFromFiles({projectRoot});

				assert.deepEqual(
					result1.modules.map((m) => m.path),
					result2.modules.map((m) => m.path),
				);
			} finally {
				await cleanup();
			}
		});
	});

	describe('dependency verification', () => {
		test('verifies bidirectional dependencies and dependents', async () => {
			const {projectRoot, cleanup} = await createTestProject({
				'src/lib/core.ts': 'export const core = 1;',
				'src/lib/utils.ts': `import {core} from './core.js';\nexport const util = core + 1;`,
				'src/lib/app.ts': `import {util} from './utils.js';\nimport {core} from './core.js';\nexport const app = util + core;`,
			});

			try {
				const {modules} = await analyzeFromFiles({
					projectRoot,
					resolveDependencies: true,
				});

				const coreModule = findModule(modules, 'core.ts');
				const utilsModule = findModule(modules, 'utils.ts');
				const appModule = findModule(modules, 'app.ts');

				// core.ts: no dependencies, depended on by utils and app
				assert.deepStrictEqual(coreModule.dependencies, []);
				assertHasDependent(coreModule, 'app.ts');
				assertHasDependent(coreModule, 'utils.ts');

				// utils.ts: depends on core, depended on by app
				assertHasDependency(utilsModule, 'core.ts');
				assertHasDependent(utilsModule, 'app.ts');

				// app.ts: depends on core and utils, no dependents
				assertHasDependency(appModule, 'core.ts');
				assertHasDependency(appModule, 'utils.ts');
				assert.deepStrictEqual(appModule.dependents, []);
			} finally {
				await cleanup();
			}
		});
	});

	describe('nested directory structures', () => {
		test('handles deeply nested source files', async () => {
			const {projectRoot, cleanup} = await createTestProject({
				'src/lib/utils/math/arithmetic.ts': 'export const add = (a: number, b: number) => a + b;',
				'src/lib/utils/string/format.ts': 'export const trim = (s: string) => s.trim();',
				'src/lib/components/ui/Button.svelte':
					'<script lang="ts">let {label}: {label: string} = $props();</script><button>{label}</button>',
			});

			try {
				const {modules} = await analyzeFromFiles({
					projectRoot,
				});

				assert.strictEqual(modules.length, 3, 'Should analyze all nested files');

				// Paths should be relative to src/lib
				assert.ok(
					modules.some((m) => m.path === 'utils/math/arithmetic.ts'),
					'Should find deeply nested arithmetic.ts',
				);
				assert.ok(
					modules.some((m) => m.path === 'utils/string/format.ts'),
					'Should find deeply nested format.ts',
				);
				assert.ok(
					modules.some((m) => m.path === 'components/ui/Button.svelte'),
					'Should find deeply nested Button.svelte',
				);
			} finally {
				await cleanup();
			}
		});
	});

	describe('glob edge cases', () => {
		test('handles include patterns that match no files', async () => {
			const {projectRoot, cleanup} = await createTestProject({
				'src/lib/foo.ts': 'export const foo = 1;',
			});

			try {
				const {modules} = await analyzeFromFiles({
					projectRoot,
					include: ['src/lib/**/*.xyz'], // no files match
				});

				assert.strictEqual(modules.length, 0);
			} finally {
				await cleanup();
			}
		});
	});

	describe('JSDoc extraction', () => {
		test('extracts module-level and declaration-level documentation', async () => {
			const {projectRoot, cleanup} = await createTestProject({
				'src/lib/math.ts': `
/**
 * Math utilities.
 *
 * @module
 */

/**
 * Adds two numbers.
 * @param a First number
 * @param b Second number
 * @returns The sum
 */
export function add(a: number, b: number): number {
	return a + b;
}`,
			});

			try {
				const {modules} = await analyzeFromFiles({
					projectRoot,
				});

				const math = modules.find((m) => m.path === 'math.ts')!;

				// Module comment
				assert.ok(math.moduleComment, 'Module should have moduleComment');
				assert.include(
					math.moduleComment,
					'Math utilities',
					'Module comment should contain description',
				);

				// Declaration comment
				const addFn = math.declarations[0]!;
				assert.strictEqual(addFn.docComment, 'Adds two numbers.');
				if (addFn.kind !== 'function') throw new Error('expected function');
				assert.strictEqual(addFn.returnDescription, 'The sum');
			} finally {
				await cleanup();
			}
		});
	});

	describe('include overrides exports', () => {
		test('include patterns skip exports-based discovery', async () => {
			const {projectRoot, cleanup} = await createTestProject({
				'src/lib/index.ts': 'export const fromExports = 1;',
				'src/lib/other.ts': 'export const other = 2;',
				'package.json': JSON.stringify({
					name: 'test-pkg',
					exports: {
						'.': {
							types: './dist/index.d.ts',
							default: './dist/index.js',
						},
					},
				}),
			});

			try {
				// With include, exports field should be ignored
				const {modules} = await analyzeFromFiles({
					projectRoot,
					include: ['src/lib/other.ts'],
				});

				// Should only find other.ts, not index.ts (which exports would discover)
				assert.strictEqual(modules.length, 1);
				assert.strictEqual(modules[0]!.path, 'other.ts');
			} finally {
				await cleanup();
			}
		});
	});

	describe('discovery option', () => {
		test("falls back to glob when discovery is 'glob'", async () => {
			const {projectRoot, cleanup} = await createTestProject({
				'src/lib/foo.ts': 'export const foo = 1;',
				'src/lib/bar.ts': 'export const bar = 2;',
			});

			try {
				const {modules} = await analyzeFromFiles({
					projectRoot,
					discovery: 'glob',
				});

				assert.strictEqual(modules.length, 2);
			} finally {
				await cleanup();
			}
		});

		test("'exports' strict mode throws when package.json has no exports", async () => {
			const {projectRoot, cleanup} = await createTestProject({
				'src/lib/foo.ts': 'export const foo = 1;',
			});

			try {
				let thrown: unknown;
				try {
					await analyzeFromFiles({projectRoot, discovery: 'exports'});
				} catch (error) {
					thrown = error;
				}
				assert.ok(
					thrown instanceof Error && thrown.message.includes("discovery: 'exports' failed"),
					`should throw with strict-exports message; got: ${String(thrown)}`,
				);
			} finally {
				await cleanup();
			}
		});

		test("'exports' strict mode rejects combination with `include`", async () => {
			const {projectRoot, cleanup} = await createTestProject({
				'src/lib/foo.ts': 'export const foo = 1;',
				'package.json': JSON.stringify({
					name: 'test-pkg',
					exports: {'.': {default: './dist/foo.js'}},
				}),
			});

			try {
				let thrown: unknown;
				try {
					await analyzeFromFiles({
						projectRoot,
						discovery: 'exports',
						include: ['src/**/*.ts'],
					});
				} catch (error) {
					thrown = error;
				}
				assert.ok(
					thrown instanceof Error && thrown.message.includes('incompatible with `include`'),
					`should throw incompatibility error; got: ${String(thrown)}`,
				);
			} finally {
				await cleanup();
			}
		});

		test('uses package.json exports when available', async () => {
			const {projectRoot, cleanup} = await createTestProject({
				'src/lib/foo.ts': 'export const foo = 1;',
				'src/lib/bar.ts': 'export const bar = 2;',
				'package.json': JSON.stringify({
					name: 'test-pkg',
					exports: {
						'.': {
							types: './dist/foo.d.ts',
							default: './dist/foo.js',
						},
					},
				}),
			});

			try {
				const {modules} = await analyzeFromFiles({
					projectRoot,
				});

				// Should discover foo.ts from exports mapping
				assert.ok(
					modules.some((m) => m.path === 'foo.ts'),
					'Should discover foo.ts from package.json exports',
				);
			} finally {
				await cleanup();
			}
		});
	});

	describe('logger integration', () => {
		test('logs discovery and diagnostic messages', async () => {
			const {projectRoot, cleanup} = await createTestProject({
				'src/lib/foo.ts': 'export const foo = 1;',
			});

			try {
				const logCalls: Array<{level: string; args: Array<unknown>}> = [];
				const mockLog = {
					info: (...args: Array<unknown>) => logCalls.push({level: 'info', args}),
					warn: (...args: Array<unknown>) => logCalls.push({level: 'warn', args}),
					error: (...args: Array<unknown>) => logCalls.push({level: 'error', args}),
				};

				await analyzeFromFiles({
					projectRoot,
					log: mockLog as any,
				});

				// Should have some info logs about discovery
				const infoCalls = logCalls.filter((c) => c.level === 'info');
				assert.ok(infoCalls.length > 0, 'Should log discovery info');

				// Should have no error logs for valid code
				const errorCalls = logCalls.filter((c) => c.level === 'error');
				assert.strictEqual(errorCalls.length, 0, 'Should have no error logs');
			} finally {
				await cleanup();
			}
		});
	});
});
