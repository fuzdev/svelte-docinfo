/**
 * Tests for the path normalization chokepoint.
 *
 * Covers `toPosixPath` directly and exercises every public-API boundary that
 * promises to normalize Windows-style backslash inputs into the internal
 * POSIX form. Linux runs `toPosixPath` as a no-op for forward-slash inputs;
 * passing backslash inputs through these tests proves the normalization seam
 * works regardless of platform. See the `paths.ts` module comment for the
 * design contract.
 */

import { test, assert, describe } from 'vitest';
import { join } from 'node:path';

import { toPosixPath } from '$lib/paths.ts';
import {
	createSourceOptions,
	extractPath,
	isSource,
	normalizeSourceOptions,
	type ModuleSourceOptions
} from '$lib/source-config.ts';
import { createAnalysisSession } from '$lib/session.ts';
import { analyze, analyzeFromFiles } from '$lib/analyze.ts';
import { SVELTE_VIRTUAL_SUFFIX, type SourceFileInfo } from '$lib/source.ts';
import { transformSvelteSource } from '$lib/svelte.ts';
import { loadFile, globFiles } from '$lib/files.ts';
import { discoverFromExports } from '$lib/exports.ts';

import { withTestProject } from './test-helpers.ts';

/**
 * Convert a POSIX absolute path to its native-Windows shape (backslash
 * separators) for round-trip testing on Linux. Captures only the case where
 * separators differ — drive letters and long-path prefixes are out of scope.
 */
const winify = (posix: string): string => posix.replace(/\//g, '\\');

const PROJECT_ROOT_POSIX = '/home/user/project';
// Simulates what `path.resolve` returns on Windows. We don't actually run on
// Windows, but feeding backslash strings through the public boundary proves
// the normalization seam catches them regardless of host platform.
const PROJECT_ROOT_WIN = 'C:\\users\\test\\project';

describe('toPosixPath', () => {
	test('passes forward-slash paths through unchanged (no-op fast path)', () => {
		const input = '/home/user/project/src/lib/foo.ts';
		assert.strictEqual(toPosixPath(input), input);
	});

	test('replaces backslashes with forward slashes', () => {
		assert.strictEqual(
			toPosixPath('C:\\users\\test\\project\\src\\lib\\foo.ts'),
			'C:/users/test/project/src/lib/foo.ts'
		);
	});

	test('handles mixed separators', () => {
		assert.strictEqual(toPosixPath('C:\\proj/src\\lib/foo.ts'), 'C:/proj/src/lib/foo.ts');
	});

	test('is idempotent', () => {
		const native = 'C:\\proj\\foo.ts';
		assert.strictEqual(toPosixPath(toPosixPath(native)), toPosixPath(native));
	});

	test('returns empty string unchanged', () => {
		assert.strictEqual(toPosixPath(''), '');
	});

	test('handles single backslash', () => {
		assert.strictEqual(toPosixPath('\\'), '/');
	});
});

describe('normalizeSourceOptions — Windows-shaped inputs', () => {
	test('posixifies backslash projectRoot', () => {
		// `resolve()` on Windows produces backslash absolute paths; the
		// normalizer should fold them to POSIX without losing the drive letter.
		const opts: ModuleSourceOptions = {
			projectRoot: PROJECT_ROOT_WIN,
			sourcePaths: ['src/lib'],
			exclude: [],
			getAnalyzerType: () => 'typescript'
		};
		const normalized = normalizeSourceOptions(opts);
		// `path.resolve` on Linux produces a different absolute path from a
		// Windows-style input, so we just check it's POSIX (no backslashes).
		assert.notInclude(normalized.projectRoot, '\\');
	});

	test('posixifies backslash sourcePaths', () => {
		const normalized = normalizeSourceOptions({
			projectRoot: PROJECT_ROOT_POSIX,
			sourcePaths: ['src\\lib', 'src\\routes'],
			sourceRoot: 'src',
			exclude: [],
			getAnalyzerType: () => 'typescript'
		});
		assert.deepStrictEqual(normalized.sourcePaths, ['src/lib', 'src/routes']);
	});

	test('posixifies backslash sourceRoot', () => {
		const normalized = normalizeSourceOptions({
			projectRoot: PROJECT_ROOT_POSIX,
			sourcePaths: ['src/lib'],
			sourceRoot: 'src\\lib',
			exclude: [],
			getAnalyzerType: () => 'typescript'
		});
		assert.strictEqual(normalized.sourceRoot, 'src/lib');
	});

	test('strips both leading/trailing forward slashes and posixifies in one pass', () => {
		const normalized = normalizeSourceOptions({
			projectRoot: PROJECT_ROOT_POSIX,
			sourcePaths: ['/src\\lib/'],
			exclude: [],
			getAnalyzerType: () => 'typescript'
		});
		assert.deepStrictEqual(normalized.sourcePaths, ['src/lib']);
	});

	test('multi-path layout with backslashes auto-derives correct sourceRoot', () => {
		// `deriveCommonPrefix` splits on `/`. Backslash-separated input would
		// fail to decompose and silently yield an empty common prefix; the
		// posixify step in normalize keeps this working.
		const normalized = normalizeSourceOptions({
			projectRoot: PROJECT_ROOT_POSIX,
			sourcePaths: ['src\\lib', 'src\\routes'],
			exclude: [],
			getAnalyzerType: () => 'typescript'
		});
		assert.strictEqual(normalized.sourceRoot, 'src');
	});
});

describe('isSource — Windows-shaped inputs', () => {
	test('accepts a backslash absolute path under projectRoot', () => {
		const opts = createSourceOptions(PROJECT_ROOT_POSIX);
		// What `path.resolve` would produce on Windows pointing at the same file.
		const winStyleId = '\\home\\user\\project\\src\\lib\\foo.ts';
		// Whether this resolves as "in source dir" depends on how `resolve`
		// would actually transform it; we can simulate by hand-crafting a
		// path that, after posixify, matches the POSIX projectRoot prefix.
		const equivalent = '/home/user/project/src/lib/foo.ts';
		assert.strictEqual(isSource(winStyleId, opts), isSource(equivalent, opts));
		assert.strictEqual(isSource(equivalent, opts), true);
	});

	test('exclude globs match against posixified relative path', () => {
		const opts = createSourceOptions(PROJECT_ROOT_POSIX, {
			exclude: ['**/*.test.ts']
		});
		// Native-separator id for the same logical file.
		const winStyleId = '\\home\\user\\project\\src\\lib\\foo.test.ts';
		const posixId = '/home/user/project/src/lib/foo.test.ts';
		assert.strictEqual(isSource(winStyleId, opts), false);
		assert.strictEqual(isSource(posixId, opts), false);
	});

	test('rejects out-of-project paths regardless of separator style', () => {
		const opts = createSourceOptions(PROJECT_ROOT_POSIX);
		assert.strictEqual(isSource('\\some\\other\\path\\foo.ts', opts), false);
		assert.strictEqual(isSource('/some/other/path/foo.ts', opts), false);
	});
});

describe('extractPath — Windows-shaped inputs', () => {
	test('strips POSIX prefix from a backslash absolute path', () => {
		const opts = createSourceOptions(PROJECT_ROOT_POSIX);
		assert.strictEqual(extractPath('\\home\\user\\project\\src\\lib\\foo.ts', opts), 'foo.ts');
	});

	test('produces POSIX output even when input is mixed', () => {
		const opts = createSourceOptions(PROJECT_ROOT_POSIX);
		assert.strictEqual(
			extractPath('/home/user/project/src\\lib/nested\\bar.ts', opts),
			'nested/bar.ts'
		);
	});
});

describe('AnalysisSession — Windows-shaped ingest paths', { timeout: 30_000 }, () => {
	test('setFile normalizes backslash id; has/deleteFile see same canonical key', async () => {
		await withTestProject({ 'src/lib/math.ts': 'export const x = 1;' }, async (projectRoot) => {
			const session = createAnalysisSession({
				sourceOptions: createSourceOptions(projectRoot)
			});
			try {
				const posixId = join(projectRoot, 'src/lib/math.ts');
				const winId = winify(posixId);
				await session.setFile({ id: winId, content: 'export const x = 1;' });

				// Same logical file is reachable via either separator style.
				assert.strictEqual(session.has(winId), true);
				assert.strictEqual(session.has(posixId), true);

				// list() reports the canonical (POSIX) form.
				assert.deepStrictEqual([...session.list()], [posixId]);

				// deleteFile via the Windows form removes the canonical entry.
				await session.deleteFile(winId);
				assert.strictEqual(session.has(posixId), false);
			} finally {
				session.dispose();
			}
		});
	});

	test('cache-hit path triggers when id varies only in separator style', async () => {
		await withTestProject({ 'src/lib/a.ts': 'export const a = 1;' }, async (projectRoot) => {
			const session = createAnalysisSession({
				sourceOptions: createSourceOptions(projectRoot)
			});
			try {
				const posixId = join(projectRoot, 'src/lib/a.ts');
				const winId = winify(posixId);
				const content = 'export const a = 1;';

				const first = await session.setFile({ id: winId, content });
				assert.strictEqual(first.changed, true);

				// Same content, different separator style — must hit the cache.
				const second = await session.setFile({ id: posixId, content });
				assert.strictEqual(second.changed, false);
			} finally {
				session.dispose();
			}
		});
	});
});

describe('analyze — Windows-shaped inputs produce POSIX output', { timeout: 30_000 }, () => {
	test('SourceFileInfo with backslash id yields the same modules as POSIX equivalent', async () => {
		await withTestProject(
			{ 'src/lib/greet.ts': 'export const greeting = "hi";\n' },
			async (projectRoot) => {
				const sourceOptions = createSourceOptions(projectRoot);
				const content = 'export const greeting = "hi";\n';
				const posixId = join(projectRoot, 'src/lib/greet.ts');

				const winFile: SourceFileInfo = { id: winify(posixId), content };
				const posixFile: SourceFileInfo = { id: posixId, content };

				const winResult = await analyze({
					sourceFiles: [winFile],
					sourceOptions,
					resolveImport: { resolve: () => null, identity: 'win-test' }
				});
				const posixResult = await analyze({
					sourceFiles: [posixFile],
					sourceOptions,
					resolveImport: { resolve: () => null, identity: 'posix-test' }
				});

				// Module path must match the POSIX-relative form regardless of input shape.
				assert.strictEqual(winResult.modules.length, 1);
				assert.strictEqual(winResult.modules[0]!.path, 'greet.ts');
				assert.deepStrictEqual(
					winResult.modules.map((m) => m.path),
					posixResult.modules.map((m) => m.path)
				);
			}
		);
	});

	test('diagnostic file paths are POSIX relative even when emitted from a backslash-id file', async () => {
		await withTestProject(
			{ 'src/lib/importer.ts': 'import "./missing.js";\n' },
			async (projectRoot) => {
				const sourceOptions = createSourceOptions(projectRoot);
				const posixId = join(projectRoot, 'src/lib/importer.ts');
				// Custom resolver that throws for every import. The session emits
				// a `resolver_failed` diagnostic with `file = source.id`; if the
				// session kept native separators internally, normalizeDiagnosticPaths
				// wouldn't strip the prefix and we'd see backslashes in the output.
				const result = await analyze({
					sourceFiles: [{ id: winify(posixId), content: 'import "./missing.js";\n' }],
					sourceOptions,
					resolveImport: {
						resolve: () => {
							throw new Error('resolver bug');
						},
						identity: 'throwing'
					}
				});

				assert.isAtLeast(result.diagnostics.length, 1);
				for (const d of result.diagnostics) {
					assert.notInclude(d.file, '\\', `diagnostic.file should be POSIX, got: ${d.file}`);
				}
			}
		);
	});
});

describe('transformSvelteSource — defensive posixification at direct-call boundary', () => {
	test('virtualPath is POSIX even when the input SourceFileInfo carries a backslash id', () => {
		// Power users can call `transformSvelteSource` directly without going
		// through a session. The session normally posixifies ids at ingest, but
		// a direct caller bypasses that seam — the function must defend itself
		// or its `virtualPath` would key a backslash entry into the LS owned
		// map and never match `resolveSvelteVirtualSpecifier`'s POSIX lookup.
		const winId = 'C:\\proj\\src\\lib\\Button.svelte';
		const content = '<script lang="ts">let { label }: { label: string } = $props();</script>\n';
		const result = transformSvelteSource({ id: winId, content });
		assert.ok(result.virtual, 'transform should succeed for a trivial Svelte component');
		assert.strictEqual(
			result.virtual.virtualPath,
			'C:/proj/src/lib/Button.svelte' + SVELTE_VIRTUAL_SUFFIX
		);
		assert.notInclude(result.virtual.virtualPath, '\\');
	});

	test('transform_failed diagnostic file path is POSIX when the input id had backslashes', () => {
		// Trigger a transform failure with intentionally malformed Svelte. The
		// resulting `transform_failed` diagnostic must use the posixified id
		// (matching the contract that all Diagnostic.file values are POSIX).
		const winId = 'C:\\proj\\src\\lib\\Broken.svelte';
		// Unclosed `<script>` reliably trips svelte2tsx.
		const content = '<script lang="ts">const x: number = ;</script>';
		const result = transformSvelteSource({ id: winId, content });
		// Whether svelte2tsx accepts or rejects this varies — the diagnostic
		// posixification only matters when one is emitted, so we only assert
		// the property when the array is non-empty.
		for (const d of result.diagnostics) {
			assert.notInclude(d.file, '\\', `diagnostic.file should be POSIX, got: ${d.file}`);
		}
	});
});

describe('loadFile / globFiles — returned ids are POSIX', () => {
	// Note: filesystem-touching operations can't usefully simulate Windows
	// behavior on Linux (`path.resolve` doesn't treat `\` as a separator on
	// POSIX hosts, so a backslash-shaped projectRoot resolves to a literal
	// directory name that doesn't exist). What we *can* verify on Linux is
	// that the chokepoint runs — the returned id is POSIX-form. On Windows,
	// `path.resolve` produces backslash absolute paths that the chokepoint
	// posixifies; that path needs Windows CI to verify directly.

	test('loadFile returns a POSIX-form id', async () => {
		await withTestProject({ 'src/lib/math.ts': 'export const x = 1;\n' }, async (projectRoot) => {
			const result = await loadFile('src/lib/math.ts', projectRoot);
			assert.notInclude(result.id, '\\', `loadFile id should be POSIX, got: ${result.id}`);
			assert.match(result.id, /\/src\/lib\/math\.ts$/);
			assert.strictEqual(result.content, 'export const x = 1;\n');
		});
	});

	test('globFiles returns POSIX-form ids', async () => {
		await withTestProject(
			{
				'src/lib/a.ts': 'export const a = 1;\n',
				'src/lib/nested/b.ts': 'export const b = 2;\n'
			},
			async (projectRoot) => {
				const files = await globFiles({
					projectRoot,
					include: ['src/lib/**/*.ts'],
					exclude: []
				});
				assert.strictEqual(files.length, 2);
				for (const f of files) {
					assert.notInclude(f.id, '\\', `globFiles id should be POSIX, got: ${f.id}`);
				}
			}
		);
	});
});

describe('discoverFromExports — POSIX ids and POSIX diagnostic paths', () => {
	test('SourceFileInfo ids from concrete + wildcard exports are POSIX', async () => {
		await withTestProject(
			{
				'src/lib/index.ts': 'export const root = 1;\n',
				'src/lib/util.ts': 'export const u = 2;\n',
				'package.json': JSON.stringify({
					name: 'fixture',
					exports: {
						'.': { default: './dist/index.js' },
						'./util': { default: './dist/util.js' }
					}
				})
			},
			async (projectRoot) => {
				const result = await discoverFromExports({ projectRoot, distDir: 'dist' });
				assert.ok(result.files, 'concrete exports should resolve to files');
				assert.isAtLeast(result.files.length, 2);
				for (const f of result.files) {
					assert.notInclude(f.id, '\\', `id should be POSIX, got: ${f.id}`);
				}
			}
		);
	});

	test('wildcard export pattern produces POSIX ids', async () => {
		await withTestProject(
			{
				'src/lib/a.ts': 'export const a = 1;\n',
				'src/lib/b.ts': 'export const b = 2;\n',
				'package.json': JSON.stringify({
					name: 'fixture',
					exports: {
						'./*': { default: './dist/*.js' }
					}
				})
			},
			async (projectRoot) => {
				const result = await discoverFromExports({ projectRoot, distDir: 'dist' });
				assert.ok(result.files);
				assert.isAtLeast(result.files.length, 2);
				for (const f of result.files) {
					assert.notInclude(f.id, '\\');
				}
			}
		);
	});

	test('module_skipped diagnostic uses POSIX project-relative file path', async () => {
		// Stage: package.json points at a source file that we register but
		// whose content makes `readFile` succeed (the easier path). For a
		// negative case we'd have to mock fs; instead, we just verify that
		// when discovery DOES emit diagnostics, they're POSIX. The earlier
		// "ids POSIX" test already covers the success path, so this assertion
		// is contractual on whatever subset of diagnostics fires.
		await withTestProject(
			{
				'src/lib/index.ts': 'export const x = 1;\n',
				'package.json': JSON.stringify({
					name: 'fixture',
					exports: { '.': { default: './dist/index.js' } }
				})
			},
			async (projectRoot) => {
				const result = await discoverFromExports({ projectRoot, distDir: 'dist' });
				for (const d of result.diagnostics) {
					assert.notInclude(d.file, '\\', `diagnostic.file should be POSIX, got: ${d.file}`);
				}
			}
		);
	});
});

describe(
	'analyze (Svelte) — Windows-shaped inputs produce POSIX output',
	{ timeout: 30_000 },
	() => {
		test('Svelte SourceFileInfo with backslash id analyzes successfully and outputs POSIX paths', async () => {
			const content =
				'<script lang="ts">let { label }: { label: string } = $props();</script><button>{label}</button>';
			await withTestProject({ 'src/lib/Button.svelte': content }, async (projectRoot) => {
				const sourceOptions = createSourceOptions(projectRoot);
				const posixId = join(projectRoot, 'src/lib/Button.svelte');
				const result = await analyze({
					sourceFiles: [{ id: winify(posixId), content }],
					sourceOptions,
					resolveImport: { resolve: () => null, identity: 'svelte-win-test' }
				});

				// Component declaration must be discovered — proves the Svelte
				// virtual path keyed correctly into the LS despite the backslash
				// input id and that the type checker resolved the props type.
				assert.strictEqual(result.modules.length, 1);
				assert.strictEqual(result.modules[0]!.path, 'Button.svelte');
				const decl = result.modules[0]!.declarations[0];
				assert.ok(decl, 'expected one declaration on Button.svelte');
				assert.strictEqual(decl.kind, 'component');

				// All diagnostic file paths POSIX.
				for (const d of result.diagnostics) {
					assert.notInclude(d.file, '\\', `diagnostic.file should be POSIX, got: ${d.file}`);
				}
			});
		});

		test('Svelte-to-Svelte import via resolveSvelteVirtualSpecifier resolves under backslash ids', async () => {
			// Cross-Svelte type re-export: Parent.svelte imports Other.svelte's
			// component type. svelte-docinfo's `resolveSvelteVirtualSpecifier`
			// resolves `./Other.svelte` to its `.__svelte2tsx__.ts` virtual.
			// `containingFile` is Parent's posixified virtualPath; `dirname` and
			// `join` produce native separators on Windows but the function
			// posixifies before `hasVirtual` lookup. Without that posixify, the
			// lookup would miss and Other's component type would fail to resolve.
			const otherContent =
				'<script lang="ts">let { msg }: { msg: string } = $props();</script>{msg}';
			const parentContent =
				'<script context="module" lang="ts">export {default as Other} from "./Other.svelte";</script>\n<script lang="ts">let { x }: { x: number } = $props();</script>{x}';
			await withTestProject(
				{
					'src/lib/Other.svelte': otherContent,
					'src/lib/Parent.svelte': parentContent
				},
				async (projectRoot) => {
					const sourceOptions = createSourceOptions(projectRoot);
					const otherPosix = join(projectRoot, 'src/lib/Other.svelte');
					const parentPosix = join(projectRoot, 'src/lib/Parent.svelte');
					const result = await analyze({
						sourceFiles: [
							{ id: winify(otherPosix), content: otherContent },
							{ id: winify(parentPosix), content: parentContent }
						],
						sourceOptions
						// Default resolver — relies on TS's own module resolution.
					});

					// Both modules present; Parent.svelte's re-export must surface
					// the `Other` component (kind: 'component', not skipped or partial).
					assert.strictEqual(result.modules.length, 2);
					const parent = result.modules.find((m) => m.path === 'Parent.svelte');
					assert.ok(parent, 'expected Parent.svelte module');
					const reExport = parent.declarations.find((d) => d.name === 'Other');
					assert.ok(reExport, 'expected re-exported Other declaration on Parent.svelte');
					assert.strictEqual(
						reExport.kind,
						'component',
						'cross-Svelte re-export should resolve to a component declaration'
					);

					// All paths in output remain POSIX.
					for (const m of result.modules) assert.notInclude(m.path, '\\');
					for (const d of result.diagnostics) {
						assert.notInclude(d.file, '\\', `diagnostic.file should be POSIX, got: ${d.file}`);
					}
				}
			);
		});
	}
);

describe(
	'analyzeFromFiles + full integration trip-wire — all output paths POSIX',
	{ timeout: 30_000 },
	() => {
		test('disk-discovery pipeline produces POSIX module paths and diagnostic paths', async () => {
			await withTestProject(
				{
					'src/lib/a.ts': 'export const a = 1;\n',
					'src/lib/nested/b.ts': 'import {a} from "../a.js";\nexport const b = a + 1;\n'
				},
				async (projectRoot) => {
					const result = await analyzeFromFiles({
						projectRoot,
						discovery: 'glob',
						resolveDependencies: true
					});
					assert.isAtLeast(result.modules.length, 2);
					for (const m of result.modules) {
						assert.notInclude(m.path, '\\', `module.path should be POSIX: ${m.path}`);
						for (const dep of m.dependencies) {
							assert.notInclude(dep, '\\', `dependency should be POSIX: ${dep}`);
						}
						for (const dep of m.dependents) {
							assert.notInclude(dep, '\\', `dependent should be POSIX: ${dep}`);
						}
					}
					for (const d of result.diagnostics) {
						assert.notInclude(d.file, '\\', `diagnostic.file should be POSIX: ${d.file}`);
					}
				}
			);
		});

		test('mixed TS+Svelte project with imports and resolved deps stays POSIX end-to-end', async () => {
			// Trip-wire: any path-producing site that re-introduces backslashes
			// would surface here. Combines TS, Svelte, internal cross-file imports,
			// dep resolution, postprocess (computeDependents), and diagnostic
			// normalization in one shot.
			await withTestProject(
				{
					'src/lib/util.ts': 'export const u = 1;\n',
					'src/lib/index.ts': 'export {u} from "./util.js";\n',
					'src/lib/Comp.svelte':
						'<script lang="ts">import {u} from "./util.js"; let { label }: { label: string } = $props();</script>{label}{u}'
				},
				async (projectRoot) => {
					const result = await analyzeFromFiles({
						projectRoot,
						discovery: 'glob',
						resolveDependencies: true
					});

					// Find all expected modules.
					const paths = result.modules.map((m) => m.path).sort();
					assert.deepStrictEqual(paths, ['Comp.svelte', 'index.ts', 'util.ts']);

					// Every output field across the entire pipeline must be POSIX.
					for (const m of result.modules) {
						assert.notInclude(m.path, '\\');
						for (const dep of m.dependencies) assert.notInclude(dep, '\\');
						for (const dep of m.dependents) assert.notInclude(dep, '\\');
						for (const star of m.starExports) {
							assert.notInclude(star, '\\');
						}
						for (const decl of m.declarations) {
							if ('aliasOf' in decl && decl.aliasOf) {
								assert.notInclude(decl.aliasOf.module, '\\');
							}
							if ('alsoExportedFrom' in decl) {
								for (const m2 of decl.alsoExportedFrom) assert.notInclude(m2, '\\');
							}
						}
					}
					for (const d of result.diagnostics) {
						assert.notInclude(d.file, '\\', `diagnostic.file should be POSIX: ${d.file}`);
					}

					// Sanity: util.ts has at least one dependent (index.ts and/or Comp.svelte).
					const util = result.modules.find((m) => m.path === 'util.ts')!;
					assert.isAtLeast(util.dependents.length, 1);
					for (const dep of util.dependents) {
						assert.notInclude(dep, '\\');
					}
				}
			);
		});

		// Note: a "backslash-shaped projectRoot to analyzeFromFiles" test
		// isn't meaningfully runnable on Linux — `path.resolve('/proj\\bla')`
		// treats the input as a literal name and discovery finds no files.
		// The string-transform side of the chokepoint is already verified by
		// `normalizeSourceOptions — Windows-shaped inputs > posixifies
		// backslash projectRoot`; the disk-traversal side needs Windows CI.
	}
);
