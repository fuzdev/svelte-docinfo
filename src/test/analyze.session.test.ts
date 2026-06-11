/**
 * Tests for `createAnalysisSession` — the persistent incremental analysis handle.
 *
 * The session's invariants are:
 *
 * 1. **Stable output** — repeated `setFiles + query` cycles with identical
 *    inputs produce deep-equal `AnalyzeResultJson`. No stale data leaks; nothing
 *    accumulates across calls.
 * 2. **Mutation correctness** — when a file's content changes between calls,
 *    the next query reflects the new content.
 * 3. **Removal** — `deleteFile` drops files from output and the LS.
 * 4. **Addition** — files added mid-session appear in output.
 * 5. **Caching efficiency** — svelte2tsx is invoked only on first ingest and
 *    on files whose `.svelte` content actually changed. Unchanged Svelte
 *    files skip the transform on subsequent `setFile` calls.
 * 6. **Cache-hit no-op** — `setFile` with identical content + same resolver
 *    identity returns `{changed: false}` and runs no work.
 * 7. **Transform-failed placeholder** — Svelte files whose svelte2tsx throws
 *    surface in `query().modules` as `{partial: true, declarations: []}`.
 *
 * The svelte2tsx call-count tests use `vi.spyOn` on the `svelte` module
 * namespace — Vitest's ESM transform routes named imports through the
 * namespace, so spying there intercepts the binding the session reads.
 */

import {test, assert, describe, vi, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';

import {createAnalysisSession} from '$lib/session.js';
import * as svelteModule from '$lib/svelte.js';
import type {SourceFileInfo} from '$lib/source.js';
import {createSourceOptions} from '$lib/source-config.js';

import {withTestProject} from './test-helpers.js';

const TS_FILE = (root: string) => join(root, 'src/lib/math.ts');
const SVELTE_FILE = (root: string) => join(root, 'src/lib/Button.svelte');
const OTHER_FILE = (root: string) => join(root, 'src/lib/other.ts');
const BROKEN_SVELTE = (root: string) => join(root, 'src/lib/Broken.svelte');

const MATH_V1 = `
/** Adds two numbers. */
export const add = (a: number, b: number): number => a + b;
`;

const MATH_V2 = `
/** Adds two numbers. */
export const add = (a: number, b: number): number => a + b;
/** Subtracts. */
export const subtract = (a: number, b: number): number => a - b;
`;

const BUTTON_V1 = `
<script lang="ts">
	let {label}: {label: string} = $props();
</script>
<button>{label}</button>
`;

const BUTTON_V2 = `
<script lang="ts">
	let {label, disabled = false}: {label: string; disabled?: boolean} = $props();
</script>
<button {disabled}>{label}</button>
`;

const OTHER = `export const VERSION = '1.0.0';`;

describe('createAnalysisSession', {timeout: 30_000}, () => {
	test('stable output across identical query calls', async () => {
		await withTestProject(
			{
				'src/lib/math.ts': MATH_V1,
				'src/lib/Button.svelte': BUTTON_V1,
			},
			async (projectRoot) => {
				const sourceFiles: Array<SourceFileInfo> = [
					{id: TS_FILE(projectRoot), content: MATH_V1},
					{id: SVELTE_FILE(projectRoot), content: BUTTON_V1},
				];

				const session = createAnalysisSession({
					sourceOptions: createSourceOptions(projectRoot),
				});
				try {
					await session.setFiles(sourceFiles);
					const r1 = session.query();
					const r2 = session.query();
					// Deep-equal is enough — array order is deterministic via sortModules.
					assert.deepStrictEqual(r2.modules, r1.modules);
					assert.deepStrictEqual(r2.diagnostics, r1.diagnostics);
				} finally {
					session.dispose();
				}
			},
		);
	});

	test('TS mutation reflects in next query', async () => {
		await withTestProject(
			{
				'src/lib/math.ts': MATH_V1,
			},
			async (projectRoot) => {
				const session = createAnalysisSession({
					sourceOptions: createSourceOptions(projectRoot),
				});
				try {
					await session.setFile({id: TS_FILE(projectRoot), content: MATH_V1});
					const r1 = session.query();
					const decls1 = r1.modules[0]!.declarations.map((d) => d.name).sort();
					assert.deepStrictEqual(decls1, ['add']);

					await session.setFile({id: TS_FILE(projectRoot), content: MATH_V2});
					const r2 = session.query();
					const decls2 = r2.modules[0]!.declarations.map((d) => d.name).sort();
					assert.deepStrictEqual(decls2, ['add', 'subtract']);
				} finally {
					session.dispose();
				}
			},
		);
	});

	test('Svelte mutation reflects in next query', async () => {
		await withTestProject(
			{
				'src/lib/Button.svelte': BUTTON_V1,
			},
			async (projectRoot) => {
				const session = createAnalysisSession({
					sourceOptions: createSourceOptions(projectRoot),
				});
				try {
					await session.setFile({id: SVELTE_FILE(projectRoot), content: BUTTON_V1});
					const r1 = session.query();
					const c1 = r1.modules[0]!.declarations[0]!;
					assert.strictEqual(c1.kind, 'component');
					if (c1.kind !== 'component') throw new Error('not a component');
					const props1 = c1.props.map((p) => p.name).sort();
					assert.deepStrictEqual(props1, ['label']);

					await session.setFile({id: SVELTE_FILE(projectRoot), content: BUTTON_V2});
					const r2 = session.query();
					const c2 = r2.modules[0]!.declarations[0]!;
					assert.strictEqual(c2.kind, 'component');
					if (c2.kind !== 'component') throw new Error('not a component');
					const props2 = c2.props.map((p) => p.name).sort();
					assert.deepStrictEqual(props2, ['disabled', 'label']);
				} finally {
					session.dispose();
				}
			},
		);
	});

	test('deleted file disappears from output', async () => {
		await withTestProject(
			{
				'src/lib/math.ts': MATH_V1,
				'src/lib/other.ts': OTHER,
			},
			async (projectRoot) => {
				const session = createAnalysisSession({
					sourceOptions: createSourceOptions(projectRoot),
				});
				try {
					await session.setFiles([
						{id: TS_FILE(projectRoot), content: MATH_V1},
						{id: OTHER_FILE(projectRoot), content: OTHER},
					]);
					const r1 = session.query();
					assert.strictEqual(r1.modules.length, 2);

					await session.deleteFile(OTHER_FILE(projectRoot));
					const r2 = session.query();
					assert.strictEqual(r2.modules.length, 1);
					assert.ok(r2.modules[0]!.path.endsWith('math.ts'));
				} finally {
					session.dispose();
				}
			},
		);
	});

	test('added file appears in output', async () => {
		await withTestProject(
			{
				'src/lib/math.ts': MATH_V1,
				'src/lib/other.ts': OTHER,
			},
			async (projectRoot) => {
				const session = createAnalysisSession({
					sourceOptions: createSourceOptions(projectRoot),
				});
				try {
					await session.setFile({id: TS_FILE(projectRoot), content: MATH_V1});
					const r1 = session.query();
					assert.strictEqual(r1.modules.length, 1);

					await session.setFile({id: OTHER_FILE(projectRoot), content: OTHER});
					const r2 = session.query();
					const paths2 = r2.modules.map((m) => m.path).sort();
					assert.strictEqual(paths2.length, 2);
					assert.ok(paths2.some((p) => p.endsWith('other.ts')));
				} finally {
					session.dispose();
				}
			},
		);
	});

	test('reExports edge survives when the canonical module is outside the owned set', async () => {
		// The LS host falls back to disk reads for non-owned files, so a barrel
		// re-exporting from an unowned source file still resolves the canonical
		// and publishes the forward edge — but no module (and so no
		// alsoExportedFrom back-link) exists for it in the result. This is the
		// documented presence caveat shared with `aliasOf.module` and
		// `starExports`.
		await withTestProject(
			{
				'src/lib/a.ts': `export const foo = 1;\n`,
				'src/lib/barrel.ts': `export {foo} from './a.js';\n`,
			},
			async (projectRoot) => {
				const session = createAnalysisSession({
					sourceOptions: createSourceOptions(projectRoot),
				});
				try {
					// own only the barrel — a.ts exists on disk but is never set
					await session.setFile({
						id: join(projectRoot, 'src/lib/barrel.ts'),
						content: `export {foo} from './a.js';\n`,
					});
					const {modules} = session.query();
					assert.deepStrictEqual(
						modules.map((m) => m.path),
						['barrel.ts'],
					);
					assert.deepStrictEqual(modules[0]!.reExports, [
						{name: 'foo', module: 'a.ts', typeOnly: false, sourceLine: 1},
					]);
				} finally {
					session.dispose();
				}
			},
		);
	});

	test('has and list reflect owned set', async () => {
		await withTestProject(
			{
				'src/lib/math.ts': MATH_V1,
				'src/lib/other.ts': OTHER,
			},
			async (projectRoot) => {
				const session = createAnalysisSession({
					sourceOptions: createSourceOptions(projectRoot),
				});
				try {
					assert.strictEqual(session.list().length, 0);
					assert.strictEqual(session.has(TS_FILE(projectRoot)), false);

					await session.setFile({id: TS_FILE(projectRoot), content: MATH_V1});
					assert.strictEqual(session.has(TS_FILE(projectRoot)), true);
					assert.strictEqual(session.list().length, 1);

					await session.setFile({id: OTHER_FILE(projectRoot), content: OTHER});
					assert.strictEqual(session.list().length, 2);

					await session.deleteFile(TS_FILE(projectRoot));
					assert.strictEqual(session.has(TS_FILE(projectRoot)), false);
					assert.strictEqual(session.list().length, 1);
				} finally {
					session.dispose();
				}
			},
		);
	});

	test('cache hit returns changed: false with same diagnostics', async () => {
		await withTestProject(
			{
				'src/lib/math.ts': MATH_V1,
			},
			async (projectRoot) => {
				const session = createAnalysisSession({
					sourceOptions: createSourceOptions(projectRoot),
				});
				try {
					const r1 = await session.setFile({id: TS_FILE(projectRoot), content: MATH_V1});
					assert.strictEqual(r1.changed, true);

					const r2 = await session.setFile({id: TS_FILE(projectRoot), content: MATH_V1});
					assert.strictEqual(r2.changed, false);
					assert.deepStrictEqual(r2.diagnostics, r1.diagnostics);
				} finally {
					session.dispose();
				}
			},
		);
	});

	test('setFiles aggregate result has changedIds', async () => {
		await withTestProject(
			{
				'src/lib/math.ts': MATH_V1,
				'src/lib/other.ts': OTHER,
			},
			async (projectRoot) => {
				const session = createAnalysisSession({
					sourceOptions: createSourceOptions(projectRoot),
				});
				try {
					const r1 = await session.setFiles([
						{id: TS_FILE(projectRoot), content: MATH_V1},
						{id: OTHER_FILE(projectRoot), content: OTHER},
					]);
					assert.strictEqual(r1.changedIds.size, 2);
					assert.strictEqual(r1.perFile.size, 2);
					assert.ok(r1.perFile.get(TS_FILE(projectRoot))!.changed);
					assert.ok(r1.perFile.get(OTHER_FILE(projectRoot))!.changed);

					// Re-ingest unchanged content — all files are cache hits.
					const r2 = await session.setFiles([
						{id: TS_FILE(projectRoot), content: MATH_V1},
						{id: OTHER_FILE(projectRoot), content: OTHER},
					]);
					assert.strictEqual(r2.changedIds.size, 0);
					assert.strictEqual(r2.perFile.get(TS_FILE(projectRoot))!.changed, false);
				} finally {
					session.dispose();
				}
			},
		);
	});

	describe('svelte2tsx caching', () => {
		// Spies are reset per test; each test re-installs against the live module
		// namespace so the order of test execution doesn't matter.
		beforeEach(() => {
			vi.restoreAllMocks();
		});
		afterEach(() => {
			vi.restoreAllMocks();
		});

		test('cold ingest transforms each .svelte file once', async () => {
			await withTestProject(
				{
					'src/lib/Button.svelte': BUTTON_V1,
				},
				async (projectRoot) => {
					const spy = vi.spyOn(svelteModule, 'transformSvelteSource');
					const session = createAnalysisSession({
						sourceOptions: createSourceOptions(projectRoot),
					});
					try {
						await session.setFile({id: SVELTE_FILE(projectRoot), content: BUTTON_V1});
						assert.strictEqual(spy.mock.calls.length, 1);
					} finally {
						session.dispose();
					}
				},
			);
		});

		test('unchanged Svelte file is not re-transformed on next setFile', async () => {
			await withTestProject(
				{
					'src/lib/Button.svelte': BUTTON_V1,
				},
				async (projectRoot) => {
					const spy = vi.spyOn(svelteModule, 'transformSvelteSource');
					const session = createAnalysisSession({
						sourceOptions: createSourceOptions(projectRoot),
					});
					try {
						await session.setFile({id: SVELTE_FILE(projectRoot), content: BUTTON_V1});
						assert.strictEqual(spy.mock.calls.length, 1, 'expected 1 transform on cold ingest');

						await session.setFile({id: SVELTE_FILE(projectRoot), content: BUTTON_V1});
						assert.strictEqual(
							spy.mock.calls.length,
							1,
							'expected no re-transform on unchanged input',
						);
					} finally {
						session.dispose();
					}
				},
			);
		});

		test('mutated Svelte file triggers exactly one re-transform', async () => {
			await withTestProject(
				{
					'src/lib/Button.svelte': BUTTON_V1,
				},
				async (projectRoot) => {
					const spy = vi.spyOn(svelteModule, 'transformSvelteSource');
					const session = createAnalysisSession({
						sourceOptions: createSourceOptions(projectRoot),
					});
					try {
						await session.setFile({id: SVELTE_FILE(projectRoot), content: BUTTON_V1});
						assert.strictEqual(spy.mock.calls.length, 1);

						await session.setFile({id: SVELTE_FILE(projectRoot), content: BUTTON_V2});
						assert.strictEqual(spy.mock.calls.length, 2);
					} finally {
						session.dispose();
					}
				},
			);
		});
	});

	describe('transform_failed placeholder', () => {
		beforeEach(() => {
			vi.restoreAllMocks();
		});
		afterEach(() => {
			vi.restoreAllMocks();
		});

		test('failed Svelte transform surfaces as placeholder ModuleJson and transform_failed diagnostic', async () => {
			await withTestProject(
				{
					'src/lib/Broken.svelte': BUTTON_V1, // content irrelevant — we mock transform to throw
				},
				async (projectRoot) => {
					// Mock transformSvelteSource to return failure shape.
					vi.spyOn(svelteModule, 'transformSvelteSource').mockImplementation(
						(file): ReturnType<typeof svelteModule.transformSvelteSource> => ({
							virtual: undefined,
							diagnostics: [
								{
									kind: 'transform_failed',
									file: file.id,
									message: 'svelte2tsx mock failure',
									severity: 'error',
								},
							],
						}),
					);

					const session = createAnalysisSession({
						sourceOptions: createSourceOptions(projectRoot),
					});
					try {
						const ingest = await session.setFile({
							id: BROKEN_SVELTE(projectRoot),
							content: BUTTON_V1,
						});
						// Ingest carries the transform_failed diagnostic.
						assert.strictEqual(ingest.diagnostics.length, 1);
						assert.strictEqual(ingest.diagnostics[0]!.kind, 'transform_failed');

						const result = session.query();
						// modules array contains the placeholder.
						assert.strictEqual(result.modules.length, 1);
						const placeholder = result.modules[0]!;
						assert.strictEqual(placeholder.partial, true);
						assert.deepStrictEqual(placeholder.declarations, []);
						assert.ok(placeholder.path.endsWith('Broken.svelte'));

						// Query-time diagnostics should NOT double-emit the failure
						// (the ingest diagnostic carries it).
						const queryTransformFailed = result.diagnostics.filter(
							(d) => d.kind === 'transform_failed',
						);
						assert.strictEqual(queryTransformFailed.length, 0);
						const queryRequiresProgram = result.diagnostics.filter(
							(d) => d.kind === 'module_skipped' && d.reason === 'requires_program',
						);
						assert.strictEqual(queryRequiresProgram.length, 0);
					} finally {
						session.dispose();
					}
				},
			);
		});

		// Real-world coverage: feeds a malformed `.svelte` source through the
		// session unmocked. Locks the contract against svelte2tsx version drift —
		// if a future svelte2tsx stops throwing on this input the test fails
		// loudly, prompting either a new fixture or a contract revisit.
		test('real malformed Svelte input surfaces transform_failed and placeholder', async () => {
			// Unterminated `<script>`: svelte2tsx's parser can't close the script
			// block, throws `element_unclosed`. Stable across svelte2tsx versions
			// because the unclosed-tag check is parser-fundamental.
			const MALFORMED = '<script lang="ts">const x =';
			await withTestProject({'src/lib/Malformed.svelte': MALFORMED}, async (projectRoot) => {
				const session = createAnalysisSession({
					sourceOptions: createSourceOptions(projectRoot),
				});
				try {
					const ingest = await session.setFile({
						id: join(projectRoot, 'src/lib/Malformed.svelte'),
						content: MALFORMED,
					});
					const transformFailed = ingest.diagnostics.filter((d) => d.kind === 'transform_failed');
					assert.strictEqual(
						transformFailed.length,
						1,
						'expected one transform_failed for the unterminated <script>',
					);
					assert.strictEqual(transformFailed[0]!.severity, 'error');

					const result = session.query();
					assert.strictEqual(result.modules.length, 1);
					const placeholder = result.modules[0]!;
					assert.strictEqual(placeholder.partial, true);
					assert.deepStrictEqual(placeholder.declarations, []);
					assert.ok(placeholder.path.endsWith('Malformed.svelte'));
				} finally {
					session.dispose();
				}
			});
		});

		// Stale-virtual cleanup: when a Svelte file regresses from
		// transform-succeeded to transform-failed, the session must evict the
		// prior svelte2tsx virtual from the LS so other files don't see stale
		// checker state. Verified via downstream observable — a TS importer's
		// typeSignature for the imported value degrades from the literal type
		// to `any` after regression. Without eviction, the importer would still
		// resolve against the stale virtual and keep the literal type, so this
		// assertion locks in the eviction itself, not just the placeholder shape.
		test('regression to transform_failed evicts prior virtual; importer types degrade', async () => {
			const VALID_BUTTON = `<script module lang="ts">
	export const FOO: 'valid' = 'valid';
</script>
<script lang="ts">
	let {label}: {label: string} = $props();
</script>
<button>{label}</button>
`;
			const MALFORMED_BUTTON = '<script lang="ts">const x =';
			const USES_BUTTON = "import {FOO} from './Button.svelte';\nexport const x = FOO;\n";

			await withTestProject(
				{
					'src/lib/Button.svelte': VALID_BUTTON,
					'src/lib/uses.ts': USES_BUTTON,
				},
				async (projectRoot) => {
					const session = createAnalysisSession({
						sourceOptions: createSourceOptions(projectRoot),
					});
					try {
						await session.setFiles([
							{id: SVELTE_FILE(projectRoot), content: VALID_BUTTON},
							{id: join(projectRoot, 'src/lib/uses.ts'), content: USES_BUTTON},
						]);
						const before = session.query();
						const usesBefore = before.modules.find((m) => m.path.endsWith('uses.ts'))!;
						const xBefore = usesBefore.declarations.find((d) => d.name === 'x')!;
						assert.strictEqual(
							xBefore.typeSignature,
							'"valid"',
							'before regression: importer should see Button’s literal export type',
						);

						// Regress Button.svelte. The eviction in phase 3 must drop
						// the prior virtual from the LS so the importer's checker
						// can't keep resolving FOO against stale content.
						await session.setFile({
							id: SVELTE_FILE(projectRoot),
							content: MALFORMED_BUTTON,
						});

						const after = session.query();
						const buttonAfter = after.modules.find((m) => m.path.endsWith('Button.svelte'))!;
						assert.strictEqual(buttonAfter.partial, true);
						assert.deepStrictEqual(buttonAfter.declarations, []);

						const usesAfter = after.modules.find((m) => m.path.endsWith('uses.ts'))!;
						const xAfter = usesAfter.declarations.find((d) => d.name === 'x')!;
						assert.strictEqual(
							xAfter.typeSignature,
							'any',
							'after regression: importer should no longer resolve FOO (stale virtual evicted)',
						);
						assert.notStrictEqual(
							xAfter.typeSignature,
							xBefore.typeSignature,
							'typeSignature must change — a stale virtual would keep "valid"',
						);
					} finally {
						session.dispose();
					}
				},
			);
		});
	});

	describe('resolver_failed', () => {
		// Resolver throws are recoverable: the session treats them as null
		// (missing dep edge) and emits a `resolver_failed` ingest diagnostic
		// keyed to the importing file. Distinguishes a buggy resolver from a
		// legitimately unresolvable specifier.
		test('throwing resolver surfaces resolver_failed diagnostic on importing file', async () => {
			await withTestProject(
				{
					'src/lib/a.ts': "export {b} from './b.js';\nexport const a = 1;",
					'src/lib/b.ts': 'export const b = 2;',
				},
				async (projectRoot) => {
					const session = createAnalysisSession({
						sourceOptions: createSourceOptions(projectRoot),
						resolveImport: {
							resolve: () => {
								throw new Error('boom');
							},
							identity: 'throwing-test-resolver',
						},
					});
					try {
						const ingest = await session.setFiles([
							{id: join(projectRoot, 'src/lib/a.ts'), content: "export {b} from './b.js';"},
							{id: join(projectRoot, 'src/lib/b.ts'), content: 'export const b = 2;'},
						]);
						const failures = ingest.diagnostics.filter((d) => d.kind === 'resolver_failed');
						assert.strictEqual(failures.length, 1, 'one specifier in a.ts');
						assert.strictEqual(failures[0]!.severity, 'warning');
						assert.ok(failures[0]!.file.endsWith('a.ts'));
						assert.strictEqual(failures[0]!.specifier, './b.js');

						// Analysis still completed — resolver throw is recoverable.
						const result = session.query();
						assert.strictEqual(result.modules.length, 2);
					} finally {
						session.dispose();
					}
				},
			);
		});

		// Dedup: a file importing the same specifier twice causes the resolver
		// to be called twice, both throwing. The diagnostic carries the file +
		// specifier (no per-import-site detail), so emitting two identical
		// diagnostics is just noise. One per (file, specifier) is the contract.
		test('duplicate imports of the same specifier emit a single resolver_failed', async () => {
			const SRC = "import {b} from './b.js';\nimport {c} from './b.js';\nexport const x = b + c;\n";
			await withTestProject(
				{
					'src/lib/a.ts': SRC,
					'src/lib/b.ts': 'export const b = 2; export const c = 3;',
				},
				async (projectRoot) => {
					let resolverCalls = 0;
					const session = createAnalysisSession({
						sourceOptions: createSourceOptions(projectRoot),
						resolveImport: {
							resolve: () => {
								resolverCalls++;
								throw new Error('boom');
							},
							identity: 'throwing-test-resolver',
						},
					});
					try {
						const ingest = await session.setFiles([
							{id: join(projectRoot, 'src/lib/a.ts'), content: SRC},
							{id: join(projectRoot, 'src/lib/b.ts'), content: 'export const b = 2;'},
						]);
						// Resolver was invoked twice (once per import site)…
						assert.strictEqual(resolverCalls, 2);
						// …but the diagnostic dedups on (file, specifier).
						const failures = ingest.diagnostics.filter((d) => d.kind === 'resolver_failed');
						assert.strictEqual(failures.length, 1, 'one diagnostic per (file, specifier)');
						assert.strictEqual(failures[0]!.specifier, './b.js');
					} finally {
						session.dispose();
					}
				},
			);
		});
	});

	// Per-call override: setFile/setFiles accept a `resolveImport` opts override.
	// The override identity participates in the cache key, so swapping resolvers
	// for the same content invalidates the cache.
	describe('per-call resolver override', () => {
		test('opts.resolveImport overrides the session default for that call', async () => {
			let defaultCalls = 0;
			let overrideCalls = 0;
			await withTestProject(
				{
					'src/lib/a.ts': "import {b} from './b.js';\nexport const a = b;",
					'src/lib/b.ts': 'export const b = 2;',
				},
				async (projectRoot) => {
					const session = createAnalysisSession({
						sourceOptions: createSourceOptions(projectRoot),
						resolveImport: {
							resolve: () => {
								defaultCalls++;
								return null;
							},
							identity: 'default-test',
						},
					});
					try {
						await session.setFile(
							{
								id: join(projectRoot, 'src/lib/a.ts'),
								content: "import {b} from './b.js';\nexport const a = b;",
							},
							{
								resolveImport: {
									resolve: () => {
										overrideCalls++;
										return null;
									},
									identity: 'override-test',
								},
							},
						);
						assert.strictEqual(defaultCalls, 0, 'session default must not run when overridden');
						assert.strictEqual(overrideCalls, 1, 'override must run instead');
					} finally {
						session.dispose();
					}
				},
			);
		});

		test('switching resolver identity invalidates the cache for unchanged content', async () => {
			const calls: Array<string> = [];
			await withTestProject(
				{
					'src/lib/a.ts': "import {b} from './b.js';\nexport const a = b;",
					'src/lib/b.ts': 'export const b = 2;',
				},
				async (projectRoot) => {
					const session = createAnalysisSession({
						sourceOptions: createSourceOptions(projectRoot),
					});
					try {
						const file = {
							id: join(projectRoot, 'src/lib/a.ts'),
							content: "import {b} from './b.js';\nexport const a = b;",
						};
						const r1 = await session.setFile(file, {
							resolveImport: {
								resolve: () => {
									calls.push('first');
									return null;
								},
								identity: 'first',
							},
						});
						assert.strictEqual(r1.changed, true);

						// Same content, different resolver identity → cache miss.
						const r2 = await session.setFile(file, {
							resolveImport: {
								resolve: () => {
									calls.push('second');
									return null;
								},
								identity: 'second',
							},
						});
						assert.strictEqual(r2.changed, true, 'identity change must bust the cache');
						assert.deepStrictEqual(calls, ['first', 'second']);
					} finally {
						session.dispose();
					}
				},
			);
		});
	});

	// Pre-resolved deps fast path — when the caller supplies
	// `SourceFileInfo.dependencies`, the session treats it as authoritative
	// and skips lex+resolve for that file. Build-tool integrations (Gro filer,
	// etc.) that already maintain a dep graph use this to avoid duplicate
	// resolution work.
	describe('pre-resolved dependencies', () => {
		test('skips the resolver when file.dependencies is supplied', async () => {
			let resolverCalls = 0;
			await withTestProject(
				{
					'src/lib/a.ts': "import {b} from './b.js';\nexport const a = b;",
					'src/lib/b.ts': 'export const b = 2;',
				},
				async (projectRoot) => {
					const session = createAnalysisSession({
						sourceOptions: createSourceOptions(projectRoot),
						resolveImport: {
							resolve: () => {
								resolverCalls++;
								return null;
							},
							identity: 'counting',
						},
					});
					try {
						await session.setFiles([
							{
								id: join(projectRoot, 'src/lib/a.ts'),
								content: "import {b} from './b.js';\nexport const a = b;",
								dependencies: [join(projectRoot, 'src/lib/b.ts')],
							},
							{
								id: join(projectRoot, 'src/lib/b.ts'),
								content: 'export const b = 2;',
								dependencies: [],
							},
						]);
						assert.strictEqual(resolverCalls, 0, 'resolver must not run for pre-resolved files');

						const result = session.query();
						const a = result.modules.find((m) => m.path.endsWith('a.ts'))!;
						assert.deepStrictEqual(a.dependencies, ['b.ts']);
						const b = result.modules.find((m) => m.path.endsWith('b.ts'))!;
						assert.deepStrictEqual(b.dependents, ['a.ts']);
					} finally {
						session.dispose();
					}
				},
			);
		});

		test('filters external deps from caller-supplied dependencies', async () => {
			await withTestProject(
				{
					'src/lib/a.ts': "import {b} from './b.js';\nexport const a = b;",
					'src/lib/b.ts': 'export const b = 2;',
				},
				async (projectRoot) => {
					const session = createAnalysisSession({
						sourceOptions: createSourceOptions(projectRoot),
					});
					try {
						await session.setFiles([
							{
								id: join(projectRoot, 'src/lib/a.ts'),
								content: "import {b} from './b.js';\nexport const a = b;",
								dependencies: [
									join(projectRoot, 'src/lib/b.ts'),
									join(projectRoot, 'node_modules/external/index.js'),
									join(projectRoot, 'src/lib/a.test.ts'),
								],
							},
							{
								id: join(projectRoot, 'src/lib/b.ts'),
								content: 'export const b = 2;',
								dependencies: [],
							},
						]);

						const result = session.query();
						const a = result.modules.find((m) => m.path.endsWith('a.ts'))!;
						assert.deepStrictEqual(
							a.dependencies,
							['b.ts'],
							'external + test paths filtered out via isSource',
						);
					} finally {
						session.dispose();
					}
				},
			);
		});

		test('cache hit on same content + same dependencies reference', async () => {
			let resolverCalls = 0;
			await withTestProject(
				{
					'src/lib/a.ts': 'export const a = 1;',
				},
				async (projectRoot) => {
					const session = createAnalysisSession({
						sourceOptions: createSourceOptions(projectRoot),
						resolveImport: {
							resolve: () => {
								resolverCalls++;
								return null;
							},
							identity: 'counting',
						},
					});
					try {
						const deps: ReadonlyArray<string> = [];
						const file: SourceFileInfo = {
							id: join(projectRoot, 'src/lib/a.ts'),
							content: 'export const a = 1;',
							dependencies: deps,
						};
						const r1 = await session.setFile(file);
						assert.strictEqual(r1.changed, true, 'first ingest is a cache miss');

						const r2 = await session.setFile(file);
						assert.strictEqual(r2.changed, false, 'same ref + same content → cache hit');
						assert.strictEqual(resolverCalls, 0, 'resolver still must not run');
					} finally {
						session.dispose();
					}
				},
			);
		});

		// Cache-key contract: shallow-array equality. Two distinct arrays with
		// identical contents (the Gro filer pattern: `[...Map.keys()]` per
		// call) cache-hit. Locks in the move from reference-equality to
		// shallow-array equality so a future refactor doesn't silently revert.
		// Resolver-call-count is exercised by the lex→pre-resolved mode-flip
		// test below — both calls here supply `dependencies`, so the resolver
		// is never consulted regardless of cache behavior.
		test('cache hit on fresh-but-equivalent dependencies array', async () => {
			await withTestProject(
				{
					'src/lib/a.ts': "import {b} from './b.js';\nexport const a = b;",
					'src/lib/b.ts': 'export const b = 2;',
				},
				async (projectRoot) => {
					const session = createAnalysisSession({
						sourceOptions: createSourceOptions(projectRoot),
					});
					try {
						const id = join(projectRoot, 'src/lib/a.ts');
						const content = "import {b} from './b.js';\nexport const a = b;";
						const bPath = join(projectRoot, 'src/lib/b.ts');

						const r1 = await session.setFile({id, content, dependencies: [bPath]});
						assert.strictEqual(r1.changed, true);

						// Fresh array, identical contents → cache hit.
						const r2 = await session.setFile({id, content, dependencies: [bPath]});
						assert.strictEqual(r2.changed, false, 'fresh array with same contents → cache hit');
					} finally {
						session.dispose();
					}
				},
			);
		});

		test('cache miss when dependencies length changes', async () => {
			await withTestProject(
				{
					'src/lib/a.ts': "import {b} from './b.js';\nexport const a = b;",
					'src/lib/b.ts': 'export const b = 2;',
					'src/lib/c.ts': 'export const c = 3;',
				},
				async (projectRoot) => {
					const session = createAnalysisSession({
						sourceOptions: createSourceOptions(projectRoot),
					});
					try {
						const id = join(projectRoot, 'src/lib/a.ts');
						const content = "import {b} from './b.js';\nexport const a = b;";
						const bPath = join(projectRoot, 'src/lib/b.ts');
						const cPath = join(projectRoot, 'src/lib/c.ts');

						const r1 = await session.setFile({id, content, dependencies: [bPath]});
						assert.strictEqual(r1.changed, true);

						// Different length → cache miss.
						const r2 = await session.setFile({
							id,
							content,
							dependencies: [bPath, cPath],
						});
						assert.strictEqual(r2.changed, true, 'added dep must invalidate');
					} finally {
						session.dispose();
					}
				},
			);
		});

		test('cache miss when dependencies element order changes', async () => {
			await withTestProject(
				{
					'src/lib/a.ts':
						"import {b} from './b.js';\nimport {c} from './c.js';\nexport const a = b + c;",
					'src/lib/b.ts': 'export const b = 2;',
					'src/lib/c.ts': 'export const c = 3;',
				},
				async (projectRoot) => {
					const session = createAnalysisSession({
						sourceOptions: createSourceOptions(projectRoot),
					});
					try {
						const id = join(projectRoot, 'src/lib/a.ts');
						const content =
							"import {b} from './b.js';\nimport {c} from './c.js';\nexport const a = b + c;";
						const bPath = join(projectRoot, 'src/lib/b.ts');
						const cPath = join(projectRoot, 'src/lib/c.ts');

						const r1 = await session.setFile({id, content, dependencies: [bPath, cPath]});
						assert.strictEqual(r1.changed, true);

						// Same contents, reordered → cache miss (order is significant).
						const r2 = await session.setFile({id, content, dependencies: [cPath, bPath]});
						assert.strictEqual(r2.changed, true, 'reordered deps must invalidate');
					} finally {
						session.dispose();
					}
				},
			);
		});

		// Snapshot semantics: mutating the caller's array after passing must
		// not produce a false cache hit on the next call. The session stores
		// a snapshot at ingest time, so the next call compares against the
		// snapshot rather than the (now-mutated) reference.
		test('caller mutation of dependencies array does not produce false cache hit', async () => {
			await withTestProject(
				{
					'src/lib/a.ts': "import {b} from './b.js';\nexport const a = b;",
					'src/lib/b.ts': 'export const b = 2;',
					'src/lib/c.ts': 'export const c = 3;',
				},
				async (projectRoot) => {
					const session = createAnalysisSession({
						sourceOptions: createSourceOptions(projectRoot),
					});
					try {
						const id = join(projectRoot, 'src/lib/a.ts');
						const content = "import {b} from './b.js';\nexport const a = b;";
						const bPath = join(projectRoot, 'src/lib/b.ts');
						const cPath = join(projectRoot, 'src/lib/c.ts');

						const deps: Array<string> = [bPath];
						const r1 = await session.setFile({id, content, dependencies: deps});
						assert.strictEqual(r1.changed, true);

						// Mutate the same array reference — emulates a buggy caller.
						deps.push(cPath);

						const r2 = await session.setFile({id, content, dependencies: deps});
						assert.strictEqual(
							r2.changed,
							true,
							'mutated array must invalidate (snapshot semantics)',
						);
					} finally {
						session.dispose();
					}
				},
			);
		});

		test('mode flip (pre-resolved → lex+resolve) invalidates cache', async () => {
			let resolverCalls = 0;
			await withTestProject(
				{
					'src/lib/a.ts': "import {b} from './b.js';\nexport const a = b;",
					'src/lib/b.ts': 'export const b = 2;',
				},
				async (projectRoot) => {
					const session = createAnalysisSession({
						sourceOptions: createSourceOptions(projectRoot),
						resolveImport: {
							resolve: () => {
								resolverCalls++;
								return join(projectRoot, 'src/lib/b.ts');
							},
							identity: 'counting',
						},
					});
					try {
						const id = join(projectRoot, 'src/lib/a.ts');
						const content = "import {b} from './b.js';\nexport const a = b;";

						// First call: pre-resolved (resolver not called).
						const r1 = await session.setFile({
							id,
							content,
							dependencies: [join(projectRoot, 'src/lib/b.ts')],
						});
						assert.strictEqual(r1.changed, true);
						assert.strictEqual(resolverCalls, 0);

						// Second call: same content, no dependencies → mode flip, lex+resolve runs.
						const r2 = await session.setFile({id, content});
						assert.strictEqual(r2.changed, true, 'mode flip must invalidate');
						assert.strictEqual(resolverCalls, 1, 'lex+resolve path called the resolver');
					} finally {
						session.dispose();
					}
				},
			);
		});

		test('mode flip (lex+resolve → pre-resolved) invalidates cache', async () => {
			let resolverCalls = 0;
			await withTestProject(
				{
					'src/lib/a.ts': "import {b} from './b.js';\nexport const a = b;",
					'src/lib/b.ts': 'export const b = 2;',
				},
				async (projectRoot) => {
					const session = createAnalysisSession({
						sourceOptions: createSourceOptions(projectRoot),
						resolveImport: {
							resolve: () => {
								resolverCalls++;
								return join(projectRoot, 'src/lib/b.ts');
							},
							identity: 'counting',
						},
					});
					try {
						const id = join(projectRoot, 'src/lib/a.ts');
						const content = "import {b} from './b.js';\nexport const a = b;";

						// First call: lex+resolve (no dependencies supplied).
						const r1 = await session.setFile({id, content});
						assert.strictEqual(r1.changed, true);
						assert.strictEqual(resolverCalls, 1, 'first call ran lex+resolve');

						// Second call: same content, dependencies supplied → mode flip,
						// pre-resolved path runs (resolver not called again).
						const r2 = await session.setFile({
							id,
							content,
							dependencies: [join(projectRoot, 'src/lib/b.ts')],
						});
						assert.strictEqual(r2.changed, true, 'mode flip must invalidate');
						assert.strictEqual(resolverCalls, 1, 'pre-resolved path must not call the resolver');
					} finally {
						session.dispose();
					}
				},
			);
		});

		test('Svelte file with pre-resolved deps still transforms and yields component declaration', async () => {
			const BUTTON = `
<script lang="ts">
	import {LABEL} from './labels.js';
	let {label = LABEL}: {label?: string} = $props();
</script>
<button>{label}</button>
`;
			const LABELS = `export const LABEL = 'click me';`;
			let resolverCalls = 0;
			await withTestProject(
				{
					'src/lib/Button.svelte': BUTTON,
					'src/lib/labels.ts': LABELS,
				},
				async (projectRoot) => {
					const session = createAnalysisSession({
						sourceOptions: createSourceOptions(projectRoot),
						resolveImport: {
							resolve: () => {
								resolverCalls++;
								return null;
							},
							identity: 'counting',
						},
					});
					try {
						await session.setFiles([
							{
								id: SVELTE_FILE(projectRoot),
								content: BUTTON,
								dependencies: [join(projectRoot, 'src/lib/labels.ts')],
							},
							{
								id: join(projectRoot, 'src/lib/labels.ts'),
								content: LABELS,
								dependencies: [],
							},
						]);
						assert.strictEqual(
							resolverCalls,
							0,
							'resolver must not run when Svelte file supplies pre-resolved deps',
						);

						const result = session.query();
						const button = result.modules.find((m) => m.path.endsWith('Button.svelte'))!;
						assert.ok(button, 'Button.svelte should appear as a module');
						// Component declaration synthesized — svelte2tsx ran despite pre-resolved
						// deps; phase 1 always transforms Svelte regardless of mode.
						const component = button.declarations.find((d) => d.kind === 'component');
						assert.ok(component, 'component declaration must be synthesized');
						assert.deepStrictEqual(button.dependencies, ['labels.ts']);
						const labels = result.modules.find((m) => m.path.endsWith('labels.ts'))!;
						assert.deepStrictEqual(labels.dependents, ['Button.svelte']);
					} finally {
						session.dispose();
					}
				},
			);
		});

		// Mixed batch: some files supply `dependencies` (pre-resolved path),
		// others don't (lex+resolve path). The session's resolver-gating logic
		// should construct a resolver because at least one file needs it, but
		// only consult it for the specifiers from the lex+resolve files —
		// never for the pre-resolved files' edges. Locks in `needsResolver`'s
		// "any file lacks deps" intent (vs. a future regression that narrows
		// it to "all files lack deps").
		test('mixed batch: resolver consulted only for files lacking pre-resolved deps', async () => {
			const resolveCalls: Array<{specifier: string; from: string}> = [];
			await withTestProject(
				{
					'src/lib/a.ts': "import {b} from './b.js';\nexport const a = b;",
					'src/lib/b.ts': "import {c} from './c.js';\nexport const b = c;",
					'src/lib/c.ts': 'export const c = 3;',
				},
				async (projectRoot) => {
					const aPath = join(projectRoot, 'src/lib/a.ts');
					const bPath = join(projectRoot, 'src/lib/b.ts');
					const cPath = join(projectRoot, 'src/lib/c.ts');

					const session = createAnalysisSession({
						sourceOptions: createSourceOptions(projectRoot),
						resolveImport: {
							resolve: (specifier: string, from: string) => {
								resolveCalls.push({specifier, from});
								if (specifier === './b.js') return bPath;
								if (specifier === './c.js') return cPath;
								return null;
							},
							identity: 'counting',
						},
					});
					try {
						// a.ts: pre-resolved (deps supplied). b.ts: lex+resolve (no deps).
						// c.ts: pre-resolved with empty deps (leaf).
						await session.setFiles([
							{
								id: aPath,
								content: "import {b} from './b.js';\nexport const a = b;",
								dependencies: [bPath],
							},
							{
								id: bPath,
								content: "import {c} from './c.js';\nexport const b = c;",
								// No dependencies → lex+resolve path.
							},
							{
								id: cPath,
								content: 'export const c = 3;',
								dependencies: [],
							},
						]);

						// Resolver consulted exactly once, for b.ts's import of './c.js'.
						// a.ts and c.ts took the pre-resolved branch — their (potential)
						// imports were never lexed and never handed to the resolver.
						assert.strictEqual(
							resolveCalls.length,
							1,
							'resolver called exactly once (only b.ts went through lex+resolve)',
						);
						assert.strictEqual(resolveCalls[0]!.specifier, './c.js');
						assert.strictEqual(resolveCalls[0]!.from, bPath);

						const result = session.query();
						const a = result.modules.find((m) => m.path.endsWith('a.ts'))!;
						const b = result.modules.find((m) => m.path.endsWith('b.ts'))!;
						const c = result.modules.find((m) => m.path.endsWith('c.ts'))!;
						assert.deepStrictEqual(a.dependencies, ['b.ts']);
						assert.deepStrictEqual(b.dependencies, ['c.ts']);
						assert.deepStrictEqual(c.dependents, ['b.ts']);
						assert.deepStrictEqual(b.dependents, ['a.ts']);
					} finally {
						session.dispose();
					}
				},
			);
		});
	});

	// Trip-wire for the `MAX_RESOLVE_CONCURRENCY` bound on the session's
	// phase-2 resolver fan-out. Without bounding, a 1000-file project averaging
	// 20 imports each would launch 20k concurrent resolver calls — bad for
	// async resolvers (Vite/Rollup, user-supplied) and unfriendly to the OS
	// scheduler. The bound is exercised here with an async counting resolver.
	describe('bounded resolver concurrency', () => {
		test('phase-2 resolver fan-out caps at MAX_RESOLVE_CONCURRENCY', async () => {
			await withTestProject({}, async (projectRoot) => {
				const FILES = 5;
				const IMPORTS_PER_FILE = 30; // 150 total specifiers > 100 cap
				let in_flight = 0;
				let peak = 0;

				const session = createAnalysisSession({
					sourceOptions: createSourceOptions(projectRoot),
					resolveImport: {
						resolve: async () => {
							in_flight++;
							if (in_flight > peak) peak = in_flight;
							// Yield to the event loop so other workers actually
							// start; microtask-only delays would let one worker
							// drain everything before any peer began.
							await new Promise((r) => setTimeout(r, 1));
							in_flight--;
							return null; // unresolvable specifier — no diagnostic, no edge.
						},
						identity: 'bounded-test-resolver',
					},
				});

				try {
					const sourceFiles: Array<SourceFileInfo> = [];
					for (let f = 0; f < FILES; f++) {
						const imports = Array.from(
							{length: IMPORTS_PER_FILE},
							(_, i) => `import {x} from './fake_${f}_${i}.js';`,
						).join('\n');
						sourceFiles.push({
							id: join(projectRoot, `src/lib/file${f}.ts`),
							content: `${imports}\nexport const v${f} = ${f};\n`,
						});
					}

					await session.setFiles(sourceFiles);

					assert.isAtMost(peak, 100, 'peak in-flight ≤ MAX_RESOLVE_CONCURRENCY');
					// Sanity: with 150 tasks the cap should saturate. A peak in
					// the low single digits would mean the bound went unexercised
					// (test became vacuous).
					assert.isAtLeast(peak, 50, 'cap should saturate with 150 tasks');
				} finally {
					session.dispose();
				}
			});
		});
	});

	// Edge case: a file gets deleted, then re-added. The re-add must transform
	// fresh — it can't be a cache hit because the entry was dropped.
	describe('re-add after delete', () => {
		beforeEach(() => vi.restoreAllMocks());
		afterEach(() => vi.restoreAllMocks());

		test('re-adding a deleted Svelte file re-runs svelte2tsx', async () => {
			await withTestProject({'src/lib/Button.svelte': BUTTON_V1}, async (projectRoot) => {
				const spy = vi.spyOn(svelteModule, 'transformSvelteSource');
				const session = createAnalysisSession({
					sourceOptions: createSourceOptions(projectRoot),
				});
				try {
					await session.setFile({id: SVELTE_FILE(projectRoot), content: BUTTON_V1});
					assert.strictEqual(spy.mock.calls.length, 1);
					assert.strictEqual(session.has(SVELTE_FILE(projectRoot)), true);

					await session.deleteFile(SVELTE_FILE(projectRoot));
					assert.strictEqual(session.has(SVELTE_FILE(projectRoot)), false);

					// Re-add identical content — must transform, not cache-hit.
					const r = await session.setFile({
						id: SVELTE_FILE(projectRoot),
						content: BUTTON_V1,
					});
					assert.strictEqual(r.changed, true);
					assert.strictEqual(spy.mock.calls.length, 2, 're-add must re-transform');
				} finally {
					session.dispose();
				}
			});
		});
	});
});
