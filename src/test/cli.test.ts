/**
 * Tests for CLI (cli.ts).
 *
 * These tests cover:
 * - runCli() function with various arguments
 * - Exit codes (0 success, 1 analysis errors, 2 CLI errors)
 * - Output modes (stdout vs file)
 * - Flag combinations and interactions
 * - Help and version flags
 * - Default project root (cwd)
 * - Log wiring (discovery/diagnostic messages on stderr)
 */

import {test, assert, describe, beforeAll} from 'vitest';
import {readFile, chmod} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join} from 'node:path';

import {withTestProject} from './test-helpers.js';
import {runCliCapture, runNodeSubprocess, PROJECT_ROOT} from './test-cli-helpers.js';
import {AnalyzeResultJson} from '$lib/analyze-core.js';

/** Simple project with one module. */
const SIMPLE_PROJECT = {
	'src/lib/math.ts': 'export const add = 1;',
	'tsconfig.json': JSON.stringify({compilerOptions: {}}),
};

/** Project with two modules that import each other. */
const TWO_MODULE_PROJECT = {
	'src/lib/a.ts': `import {b} from './b.js';\nexport const a = b;`,
	'src/lib/b.ts': 'export const b = 1;',
	'tsconfig.json': JSON.stringify({compilerOptions: {}}),
};

describe('runCli', {timeout: 15_000}, () => {
	test('returns 0 on successful analysis', async () => {
		await withTestProject(SIMPLE_PROJECT, async (projectRoot) => {
			const {exitCode, stdout} = await runCliCapture([
				'node',
				'svelte-docinfo',
				projectRoot,
				'--quiet',
			]);

			assert.strictEqual(exitCode, 0);
			assert.ok(stdout.length > 0, 'Should produce output');

			const output = JSON.parse(stdout.join('\n'));
			assert.ok('modules' in output);
			assert.ok(Array.isArray(output.modules));
			assert.ok(output.modules.length > 0, 'Should find at least one module');
		});
	});

	test('writes to file with --output flag', async () => {
		await withTestProject(SIMPLE_PROJECT, async (projectRoot) => {
			const outputFile = join(projectRoot, 'output.json');

			const {exitCode} = await runCliCapture([
				'node',
				'svelte-docinfo',
				projectRoot,
				'--output',
				outputFile,
				'--quiet',
			]);

			assert.strictEqual(exitCode, 0);

			const content = await readFile(outputFile, 'utf-8');
			const output = JSON.parse(content);
			assert.ok('modules' in output);
		});
	});

	test('--output - writes to stdout (conventional stdout sentinel)', async () => {
		await withTestProject(SIMPLE_PROJECT, async (projectRoot) => {
			const {exitCode, stdout} = await runCliCapture([
				'node',
				'svelte-docinfo',
				projectRoot,
				'--output',
				'-',
				'--quiet',
			]);

			assert.strictEqual(exitCode, 0);
			assert.ok(stdout.length > 0, 'Should produce output on stdout');

			// Should be valid JSON identical in shape to the no-`-o` case.
			const output = JSON.parse(stdout.join('\n'));
			assert.ok('modules' in output);
			assert.ok(Array.isArray(output.modules));

			// No file named "-" should have been written next to the project.
			assert.ok(!existsSync(join(projectRoot, '-')), 'Should not write a file literally named "-"');
		});
	});

	test('respects --include flag', async () => {
		await withTestProject(
			{
				'src/lib/math.ts': 'export const add = 1;',
				'src/other/utils.ts': 'export const util = 2;',
				'tsconfig.json': JSON.stringify({compilerOptions: {}}),
			},
			async (projectRoot) => {
				const {exitCode, stdout} = await runCliCapture([
					'node',
					'svelte-docinfo',
					projectRoot,
					'--include',
					'src/other/**/*.ts',
					'--quiet',
				]);

				assert.strictEqual(exitCode, 0);

				const output = JSON.parse(stdout.join('\n'));
				assert.strictEqual(output.modules.length, 1);
				assert.ok(
					output.modules[0].path.endsWith('utils.ts'),
					`Expected path ending in utils.ts, got: ${output.modules[0].path}`,
				);
			},
		);
	});

	test('respects --exclude flag', async () => {
		await withTestProject(
			{
				'src/lib/math.ts': 'export const add = 1;',
				'src/lib/math.test.ts': 'test("math", () => {});',
				'tsconfig.json': JSON.stringify({compilerOptions: {}}),
			},
			async (projectRoot) => {
				const {exitCode, stdout} = await runCliCapture([
					'node',
					'svelte-docinfo',
					projectRoot,
					'--exclude',
					'**/*.test.ts',
					'--quiet',
				]);

				assert.strictEqual(exitCode, 0);

				const output = JSON.parse(stdout.join('\n'));
				assert.strictEqual(output.modules.length, 1);
				assert.ok(output.modules[0].path.endsWith('math.ts'), 'Surviving module should be math.ts');
			},
		);
	});

	test('--no-resolve-dependencies disables dependency resolution', async () => {
		await withTestProject(TWO_MODULE_PROJECT, async (projectRoot) => {
			const {exitCode, stdout} = await runCliCapture([
				'node',
				'svelte-docinfo',
				projectRoot,
				'--no-resolve-dependencies',
				'--quiet',
			]);

			assert.strictEqual(exitCode, 0);

			const output = JSON.parse(stdout.join('\n'));
			for (const mod of output.modules) {
				assert.isUndefined(mod.dependencies);
				assert.isUndefined(mod.dependents);
			}
		});
	});

	test('AnalyzeResultJson restores empty diagnostics array from compact wire format', async () => {
		await withTestProject(SIMPLE_PROJECT, async (projectRoot) => {
			const {exitCode, stdout} = await runCliCapture([
				'node',
				'svelte-docinfo',
				projectRoot,
				'--quiet',
			]);

			assert.strictEqual(exitCode, 0);

			// Wire format strips empty arrays via `compactReplacer`. Schema-side
			// `.default([])` on both fields restores them at `.parse()` — so
			// consumers programmatically ingesting analysis JSON should parse
			// through `AnalyzeResultJson` to get the symmetric envelope back.
			const output = AnalyzeResultJson.parse(JSON.parse(stdout.join('\n')));
			assert.ok(Array.isArray(output.diagnostics));
			assert.deepStrictEqual(output.diagnostics, [], 'Clean project should have no diagnostics');
		});
	});

	test('returns 1 when analysis produces error diagnostics', async () => {
		await withTestProject(
			{
				'package.json': JSON.stringify({
					name: 'test-pkg',
					exports: {
						'.': {default: './dist/index.js'},
						'./util': {default: './dist/util.js'},
					},
				}),
				'src/lib/index.ts': 'export const x = 1;',
				'src/lib/util.ts': 'export const y = 2;',
				'tsconfig.json': JSON.stringify({compilerOptions: {}}),
			},
			async (projectRoot) => {
				const unreadableFile = join(projectRoot, 'src/lib/index.ts');
				try {
					await chmod(unreadableFile, 0o111);
					const {exitCode} = await runCliCapture([
						'node',
						'svelte-docinfo',
						projectRoot,
						'--quiet',
					]);

					assert.strictEqual(exitCode, 1);
				} finally {
					await chmod(unreadableFile, 0o644).catch(() => undefined);
				}
			},
		);
	});

	test('returns 2 on invalid project path (errors bypass --quiet)', async () => {
		const {exitCode, stderr} = await runCliCapture([
			'node',
			'svelte-docinfo',
			'/nonexistent/path/that/does/not/exist',
			'--quiet',
		]);

		assert.strictEqual(exitCode, 2);
		// CLI errors go to stderr even with --quiet (bypass the log).
		// Catch block formats them as `error: <message>` (lowercase, matching log.error).
		assert.ok(
			stderr.some((e) => e.startsWith('error:')),
			`CLI errors should appear on stderr as "error: <msg>" even when quiet, got: ${stderr.join('; ')}`,
		);
	});

	test('returns 0 on empty project (no files match)', async () => {
		await withTestProject(
			{
				'src/lib/readme.md': '# Not a TypeScript file',
				'tsconfig.json': JSON.stringify({compilerOptions: {}}),
			},
			async (projectRoot) => {
				const {exitCode, stdout} = await runCliCapture([
					'node',
					'svelte-docinfo',
					projectRoot,
					'--quiet',
				]);

				assert.strictEqual(exitCode, 0);

				// Both arrays empty → wire form is `{}`; schema restores `[]`.
				const output = AnalyzeResultJson.parse(JSON.parse(stdout.join('\n')));
				assert.strictEqual(output.modules.length, 0);
			},
		);
	});

	test('multiple --include flags accumulate', async () => {
		await withTestProject(
			{
				'src/lib/a.ts': 'export const a = 1;',
				'src/other/b.ts': 'export const b = 2;',
				'src/extra/c.ts': 'export const c = 3;',
				'tsconfig.json': JSON.stringify({compilerOptions: {}}),
			},
			async (projectRoot) => {
				const {exitCode, stdout} = await runCliCapture([
					'node',
					'svelte-docinfo',
					projectRoot,
					'--include',
					'src/lib/**/*.ts',
					'--include',
					'src/other/**/*.ts',
					'--quiet',
				]);

				assert.strictEqual(exitCode, 0);

				const output = JSON.parse(stdout.join('\n'));
				// Should include lib and other, but not extra
				assert.strictEqual(output.modules.length, 2);
			},
		);
	});

	test('analyzes Svelte files', async () => {
		await withTestProject(
			{
				'src/lib/Button.svelte': `<script lang="ts">
let {label}: {label: string} = $props();
</script>
<button>{label}</button>`,
				'tsconfig.json': JSON.stringify({compilerOptions: {}}),
			},
			async (projectRoot) => {
				const {exitCode, stdout} = await runCliCapture([
					'node',
					'svelte-docinfo',
					projectRoot,
					'--quiet',
				]);

				assert.strictEqual(exitCode, 0);

				const output = JSON.parse(stdout.join('\n'));
				assert.strictEqual(output.modules.length, 1);
				assert.ok(output.modules[0].path.endsWith('Button.svelte'));
				assert.strictEqual(output.modules[0].declarations[0].kind, 'component');
			},
		);
	});

	test('--no-resolve-dependencies still includes empty diagnostics', async () => {
		await withTestProject(TWO_MODULE_PROJECT, async (projectRoot) => {
			const {exitCode, stdout} = await runCliCapture([
				'node',
				'svelte-docinfo',
				projectRoot,
				'--no-resolve-dependencies',
				'--quiet',
			]);

			assert.strictEqual(exitCode, 0);

			// Parse through the schema so empty `diagnostics` / per-module
			// `dependencies`/`dependents` defaults are restored.
			const output = AnalyzeResultJson.parse(JSON.parse(stdout.join('\n')));
			assert.ok(Array.isArray(output.diagnostics));
			for (const mod of output.modules) {
				assert.deepStrictEqual(mod.dependencies, []);
				assert.deepStrictEqual(mod.dependents, []);
			}
		});
	});

	test('default output is compact JSON', async () => {
		await withTestProject(SIMPLE_PROJECT, async (projectRoot) => {
			const {stdout} = await runCliCapture(['node', 'svelte-docinfo', projectRoot, '--quiet']);

			// Compact JSON is a single line (no indentation)
			assert.strictEqual(stdout.length, 1, 'Compact output should be a single line');
			assert.ok(!stdout[0]!.includes('\n'), 'Should not contain newlines');
		});
	});

	test('--pretty produces indented output', async () => {
		await withTestProject(SIMPLE_PROJECT, async (projectRoot) => {
			const {stdout} = await runCliCapture([
				'node',
				'svelte-docinfo',
				projectRoot,
				'--pretty',
				'--quiet',
			]);

			const raw = stdout.join('\n');
			assert.ok(raw.includes('\n'), 'Pretty output should contain newlines');
			assert.ok(raw.includes('  '), 'Pretty output should contain indentation');

			const output = JSON.parse(raw);
			assert.ok('modules' in output);
		});
	});

	test('--pretty with --output writes indented file', async () => {
		await withTestProject(SIMPLE_PROJECT, async (projectRoot) => {
			const outputFile = join(projectRoot, 'output.json');

			await runCliCapture([
				'node',
				'svelte-docinfo',
				projectRoot,
				'--pretty',
				'--output',
				outputFile,
				'--quiet',
			]);

			const content = await readFile(outputFile, 'utf-8');
			assert.ok(content.includes('\n'), 'File should contain newlines');
			assert.ok(content.includes('  '), 'File should contain indentation');
		});
	});

	test('--pretty formats both modules and diagnostics', async () => {
		await withTestProject(SIMPLE_PROJECT, async (projectRoot) => {
			const {stdout} = await runCliCapture([
				'node',
				'svelte-docinfo',
				projectRoot,
				'--pretty',
				'--quiet',
			]);

			const raw = stdout.join('\n');
			// Wire form may strip empty `diagnostics`; parse through schema to
			// confirm both keys are present after default restoration.
			const output = AnalyzeResultJson.parse(JSON.parse(raw));
			assert.ok(Array.isArray(output.modules));
			assert.ok(Array.isArray(output.diagnostics));
			assert.ok(raw.includes('  '), 'Should be pretty-printed');
		});
	});

	test('-i replaces exports discovery', async () => {
		await withTestProject(
			{
				'package.json': JSON.stringify({
					name: 'test-pkg',
					exports: {'.': {default: './dist/index.js'}},
				}),
				'src/lib/index.ts': 'export const fromExports = 1;',
				'src/lib/other.ts': 'export const fromGlob = 2;',
				'tsconfig.json': JSON.stringify({compilerOptions: {}}),
			},
			async (projectRoot) => {
				// Without -i, exports discovery finds only index.ts
				const defaultRun = await runCliCapture(['node', 'svelte-docinfo', projectRoot, '--quiet']);
				const defaultOutput = JSON.parse(defaultRun.stdout.join('\n'));
				assert.strictEqual(defaultOutput.modules.length, 1);
				assert.ok(defaultOutput.modules[0].path.includes('index'));

				// With -i, exports discovery is replaced — finds only other.ts
				const includeRun = await runCliCapture([
					'node',
					'svelte-docinfo',
					projectRoot,
					'-i',
					'src/lib/other.ts',
					'--quiet',
				]);
				const includeOutput = JSON.parse(includeRun.stdout.join('\n'));
				assert.strictEqual(includeOutput.modules.length, 1);
				assert.ok(includeOutput.modules[0].path.includes('other'));
			},
		);
	});

	test('returns 2 when --output path is unwritable', async () => {
		await withTestProject(SIMPLE_PROJECT, async (projectRoot) => {
			const {exitCode} = await runCliCapture([
				'node',
				'svelte-docinfo',
				projectRoot,
				'--output',
				'/nonexistent/dir/output.json',
				'--quiet',
			]);

			assert.strictEqual(exitCode, 2);
		});
	});

	test('--quiet suppresses stderr messages but still produces output', async () => {
		await withTestProject(SIMPLE_PROJECT, async (projectRoot) => {
			const outputFile = join(projectRoot, 'output.json');

			const {stderr} = await runCliCapture([
				'node',
				'svelte-docinfo',
				projectRoot,
				'--output',
				outputFile,
				'--quiet',
			]);

			assert.ok(
				!stderr.some((e) => e.includes('Wrote output')),
				'Should not show "Wrote output" when quiet',
			);
			assert.ok(
				!stderr.some((e) => e.includes('Discovered')),
				'Should not show discovery messages when quiet',
			);

			// Verify output file was still written despite --quiet
			const content = await readFile(outputFile, 'utf-8');
			const output = JSON.parse(content);
			assert.ok(
				Array.isArray(output.modules),
				'Output file should contain valid JSON with modules',
			);
		});
	});

	test('--quiet still surfaces analysis warnings on stderr', async () => {
		// A Svelte file with both an HTML `@component` comment and a JSDoc on
		// the script's `$props()` line triggers a `duplicate_comment` warning.
		// Locks in the contract that `-q` suppresses info only, never warnings.
		await withTestProject(
			{
				'src/lib/Comp.svelte': `<!--
	@component
	HTML version of doc.
-->
<script lang="ts">
	/**
	 * JSDoc version of doc.
	 */
	let {x = 0}: {x?: number} = $props();
</script>`,
				'tsconfig.json': JSON.stringify({compilerOptions: {}}),
			},
			async (projectRoot) => {
				const {exitCode, stderr} = await runCliCapture([
					'node',
					'svelte-docinfo',
					projectRoot,
					'--quiet',
				]);

				assert.strictEqual(exitCode, 0, 'Warnings should not fail the run');
				assert.ok(
					stderr.some((e) => e.includes('Both HTML @component comment and JSDoc')),
					`Expected duplicate_comment warning on stderr under --quiet, got: ${stderr.join('; ')}`,
				);
				assert.ok(
					!stderr.some((e) => e.includes('Discovered')),
					'Info messages should still be suppressed by --quiet',
				);
			},
		);
	});

	test('without --quiet, reports output file location and discovery info', async () => {
		await withTestProject(SIMPLE_PROJECT, async (projectRoot) => {
			const outputFile = join(projectRoot, 'output.json');

			const {stderr} = await runCliCapture([
				'node',
				'svelte-docinfo',
				projectRoot,
				'--output',
				outputFile,
			]);

			assert.ok(
				stderr.some((e) => e.includes('Wrote output')),
				'Should report output location',
			);
			assert.ok(
				stderr.some((e) => e.includes('Discovered')),
				`Expected discovery message on stderr, got: ${stderr.join('; ')}`,
			);
		});
	});

	test('multiple --exclude flags accumulate', async () => {
		await withTestProject(
			{
				'src/lib/a.ts': 'export const a = 1;',
				'src/lib/b.util.ts': 'export const b = 2;',
				'src/lib/c.helper.ts': 'export const c = 3;',
				'tsconfig.json': JSON.stringify({compilerOptions: {}}),
			},
			async (projectRoot) => {
				const {exitCode, stdout} = await runCliCapture([
					'node',
					'svelte-docinfo',
					projectRoot,
					'--exclude',
					'**/*.util.ts',
					'--exclude',
					'**/*.helper.ts',
					'--quiet',
				]);

				assert.strictEqual(exitCode, 0);

				const output = JSON.parse(stdout.join('\n'));
				assert.strictEqual(output.modules.length, 1);
				assert.ok(output.modules[0].path.endsWith('a.ts'));
			},
		);
	});

	test('--source-dir overrides default source directory', async () => {
		await withTestProject(
			{
				'src/utils.ts': 'export const util = 1;',
				'src/lib/ignored.ts': 'export const ignored = 2;',
				'tsconfig.json': JSON.stringify({compilerOptions: {}}),
			},
			async (projectRoot) => {
				// --source-dir derives include glob automatically, so --discovery glob
				// (glob fallback) discovers files in the custom source directory
				const {exitCode, stdout} = await runCliCapture([
					'node',
					'svelte-docinfo',
					projectRoot,
					'--source-dir',
					'src',
					'--discovery',
					'glob',
					'--quiet',
				]);

				assert.strictEqual(exitCode, 0);

				const output = JSON.parse(stdout.join('\n'));
				// With --source-dir src, both files are in source scope
				assert.strictEqual(output.modules.length, 2);
				const paths = output.modules.map((m: {path: string}) => m.path).sort();
				assert.ok(paths[0].endsWith('lib/ignored.ts'));
				assert.ok(paths[1].endsWith('utils.ts'));
			},
		);
	});

	test('--source-dir with exports discovery maps dist to custom source dir', async () => {
		await withTestProject(
			{
				'package.json': JSON.stringify({
					name: 'test-pkg',
					exports: {'.': {default: './dist/index.js'}},
				}),
				'src/index.ts': 'export const main = 1;',
				'tsconfig.json': JSON.stringify({compilerOptions: {}}),
			},
			async (projectRoot) => {
				const {exitCode, stdout} = await runCliCapture([
					'node',
					'svelte-docinfo',
					projectRoot,
					'--source-dir',
					'src',
					'--quiet',
				]);

				assert.strictEqual(exitCode, 0);

				const output = JSON.parse(stdout.join('\n'));
				assert.strictEqual(output.modules.length, 1);
				assert.strictEqual(output.modules[0].path, 'index.ts');
			},
		);
	});

	test('--source-dir with explicit --include uses include patterns', async () => {
		await withTestProject(
			{
				'src/a.ts': 'export const a = 1;',
				'src/b.ts': 'export const b = 2;',
				'tsconfig.json': JSON.stringify({compilerOptions: {}}),
			},
			async (projectRoot) => {
				// Explicit --include should take precedence over --source-dir derived glob
				const {exitCode, stdout} = await runCliCapture([
					'node',
					'svelte-docinfo',
					projectRoot,
					'--source-dir',
					'src',
					'--include',
					'src/a.ts',
					'--quiet',
				]);

				assert.strictEqual(exitCode, 0);

				const output = JSON.parse(stdout.join('\n'));
				assert.strictEqual(output.modules.length, 1);
				assert.strictEqual(output.modules[0].path, 'a.ts');
			},
		);
	});

	test('multiple --source-dir entries discover from each directory (monorepo)', async () => {
		await withTestProject(
			{
				'src/lib/a.ts': 'export const a = 1;',
				'src/routes/b.ts': 'export const b = 2;',
				'src/other/c.ts': 'export const c = 3;',
				'tsconfig.json': JSON.stringify({compilerOptions: {}}),
			},
			async (projectRoot) => {
				// Two source-dirs share `src` as auto-derived sourceRoot, so module
				// paths come out as `lib/a.ts` and `routes/b.ts`. `src/other/c.ts`
				// is outside both source-dirs and should be excluded.
				const {exitCode, stdout} = await runCliCapture([
					'node',
					'svelte-docinfo',
					projectRoot,
					'--source-dir',
					'src/lib',
					'--source-dir',
					'src/routes',
					'--discovery',
					'glob',
					'--quiet',
				]);

				assert.strictEqual(exitCode, 0);

				const output = JSON.parse(stdout.join('\n'));
				const paths = output.modules.map((m: {path: string}) => m.path).sort();
				assert.deepStrictEqual(paths, ['lib/a.ts', 'routes/b.ts']);
			},
		);
	});

	test('--source-root . keeps module paths project-relative for no-common-prefix dirs', async () => {
		await withTestProject(
			{
				'src/lib/a.ts': 'export const a = 1;',
				'lib/utils/b.ts': 'export const b = 2;',
				'tsconfig.json': JSON.stringify({compilerOptions: {}}),
			},
			async (projectRoot) => {
				// `src/lib` and `lib/utils` share no common prefix. `--source-root .`
				// (aliased to '' internally) anchors path extraction at projectRoot,
				// so module paths come out as `src/lib/a.ts` and `lib/utils/b.ts`.
				const {exitCode, stdout} = await runCliCapture([
					'node',
					'svelte-docinfo',
					projectRoot,
					'--source-dir',
					'src/lib',
					'--source-dir',
					'lib/utils',
					'--source-root',
					'.',
					'--discovery',
					'glob',
					'--quiet',
				]);

				assert.strictEqual(exitCode, 0);

				const output = JSON.parse(stdout.join('\n'));
				const paths = output.modules.map((m: {path: string}) => m.path).sort();
				assert.deepStrictEqual(paths, ['lib/utils/b.ts', 'src/lib/a.ts']);
			},
		);
	});

	test('multiple source-dirs with no common prefix auto-derive empty source-root', async () => {
		await withTestProject(
			{
				'src/lib/a.ts': 'export const a = 1;',
				'lib/utils/b.ts': 'export const b = 2;',
				'tsconfig.json': JSON.stringify({compilerOptions: {}}),
			},
			async (projectRoot) => {
				// Same scenario as above but without `--source-root` — auto-derive
				// returns '' for no-common-prefix sourcePaths instead of throwing.
				const {exitCode, stdout} = await runCliCapture([
					'node',
					'svelte-docinfo',
					projectRoot,
					'--source-dir',
					'src/lib',
					'--source-dir',
					'lib/utils',
					'--discovery',
					'glob',
					'--quiet',
				]);

				assert.strictEqual(exitCode, 0);

				const output = JSON.parse(stdout.join('\n'));
				const paths = output.modules.map((m: {path: string}) => m.path).sort();
				assert.deepStrictEqual(paths, ['lib/utils/b.ts', 'src/lib/a.ts']);
			},
		);
	});

	test('--source-root sets explicit module path prefix stripping', async () => {
		await withTestProject(
			{
				'packages/lib/a.ts': 'export const a = 1;',
				'packages/ui/b.ts': 'export const b = 2;',
				'tsconfig.json': JSON.stringify({compilerOptions: {}}),
			},
			async (projectRoot) => {
				// Explicit --source-root anchors path extraction at `packages`,
				// so module paths come out as `lib/a.ts` and `ui/b.ts`.
				const {exitCode, stdout} = await runCliCapture([
					'node',
					'svelte-docinfo',
					projectRoot,
					'--source-dir',
					'packages/lib',
					'--source-dir',
					'packages/ui',
					'--source-root',
					'packages',
					'--discovery',
					'glob',
					'--quiet',
				]);

				assert.strictEqual(exitCode, 0);

				const output = JSON.parse(stdout.join('\n'));
				const paths = output.modules.map((m: {path: string}) => m.path).sort();
				assert.deepStrictEqual(paths, ['lib/a.ts', 'ui/b.ts']);
			},
		);
	});

	test('--on-duplicates throw fails on duplicate names', async () => {
		await withTestProject(
			{
				'src/lib/a.ts': 'export const dup = 1;',
				'src/lib/b.ts': 'export const dup = 2;',
				'tsconfig.json': JSON.stringify({compilerOptions: {}}),
			},
			async (projectRoot) => {
				const {exitCode, stderr} = await runCliCapture([
					'node',
					'svelte-docinfo',
					projectRoot,
					'--on-duplicates',
					'throw',
					'--quiet',
				]);

				// Throw bubbles to the catch block → exit 2 with friendly error.
				assert.strictEqual(exitCode, 2);
				assert.ok(
					stderr.some((e) => e.includes('duplicate')),
					`Expected duplicate-name error on stderr, got: ${stderr.join('; ')}`,
				);
			},
		);
	});

	test('--on-duplicates rejects invalid values', async () => {
		await withTestProject(SIMPLE_PROJECT, async (projectRoot) => {
			const {exitCode, stderr} = await runCliCapture([
				'node',
				'svelte-docinfo',
				projectRoot,
				'--on-duplicates',
				'bogus',
				'--quiet',
			]);

			assert.strictEqual(exitCode, 2);
			assert.ok(
				stderr.some((e) => e.includes('Invalid --on-duplicates')),
				`Expected validation error for --on-duplicates, got: ${stderr.join('; ')}`,
			);
		});
	});

	test('--discovery glob forces glob-based discovery', async () => {
		await withTestProject(
			{
				'package.json': JSON.stringify({
					name: 'test-pkg',
					exports: {'.': {default: './dist/index.js'}},
				}),
				'src/lib/index.ts': 'export const fromExports = 1;',
				'src/lib/extra.ts': 'export const extra = 2;',
				'tsconfig.json': JSON.stringify({compilerOptions: {}}),
			},
			async (projectRoot) => {
				// With auto discovery (default), only index.ts is found via exports
				const defaultRun = await runCliCapture(['node', 'svelte-docinfo', projectRoot, '--quiet']);
				const defaultOutput = JSON.parse(defaultRun.stdout.join('\n'));
				assert.strictEqual(defaultOutput.modules.length, 1);

				// With --discovery glob, glob finds both files
				const globRun = await runCliCapture([
					'node',
					'svelte-docinfo',
					projectRoot,
					'--discovery',
					'glob',
					'--quiet',
				]);
				const globOutput = JSON.parse(globRun.stdout.join('\n'));
				assert.strictEqual(globOutput.modules.length, 2);
			},
		);
	});

	test('--discovery exports succeeds when package.json exports is present', async () => {
		await withTestProject(
			{
				'package.json': JSON.stringify({
					name: 'test-pkg',
					exports: {'.': {default: './dist/index.js'}},
				}),
				'src/lib/index.ts': 'export const main = 1;',
				'tsconfig.json': JSON.stringify({compilerOptions: {}}),
			},
			async (projectRoot) => {
				const {exitCode, stdout} = await runCliCapture([
					'node',
					'svelte-docinfo',
					projectRoot,
					'--discovery',
					'exports',
					'--quiet',
				]);

				assert.strictEqual(exitCode, 0);
				const output = JSON.parse(stdout.join('\n'));
				assert.strictEqual(output.modules.length, 1);
				assert.strictEqual(output.modules[0].path, 'index.ts');
			},
		);
	});

	test('--discovery exports throws when package.json has no exports', async () => {
		await withTestProject(SIMPLE_PROJECT, async (projectRoot) => {
			// SIMPLE_PROJECT has no package.json at all — strict mode should throw.
			const {exitCode, stderr} = await runCliCapture([
				'node',
				'svelte-docinfo',
				projectRoot,
				'--discovery',
				'exports',
				'--quiet',
			]);

			assert.strictEqual(exitCode, 2);
			assert.ok(
				stderr.some((e) => e.includes("discovery: 'exports' failed")),
				`Expected strict-exports error on stderr, got: ${stderr.join('; ')}`,
			);
		});
	});

	test('--discovery exports throws when combined with --include', async () => {
		await withTestProject(
			{
				'package.json': JSON.stringify({
					name: 'test-pkg',
					exports: {'.': {default: './dist/index.js'}},
				}),
				'src/lib/index.ts': 'export const main = 1;',
				'tsconfig.json': JSON.stringify({compilerOptions: {}}),
			},
			async (projectRoot) => {
				const {exitCode, stderr} = await runCliCapture([
					'node',
					'svelte-docinfo',
					projectRoot,
					'--discovery',
					'exports',
					'--include',
					'src/**/*.ts',
					'--quiet',
				]);

				assert.strictEqual(exitCode, 2);
				assert.ok(
					stderr.some((e) => e.includes("discovery: 'exports' is incompatible with `include`")),
					`Expected incompatibility error on stderr, got: ${stderr.join('; ')}`,
				);
			},
		);
	});

	test('--only filters output modules by glob against ModuleJson.path', async () => {
		await withTestProject(
			{
				'src/lib/a.ts': 'export const a = 1;',
				'src/lib/b.ts': 'export const b = 2;',
				'src/lib/sub/c.ts': 'export const c = 3;',
				'tsconfig.json': JSON.stringify({compilerOptions: {}}),
			},
			async (projectRoot) => {
				const {exitCode, stdout} = await runCliCapture([
					'node',
					'svelte-docinfo',
					projectRoot,
					'--only',
					'sub/**',
					'--quiet',
				]);

				assert.strictEqual(exitCode, 0);

				const output = JSON.parse(stdout.join('\n'));
				assert.strictEqual(output.modules.length, 1);
				assert.ok(
					output.modules[0].path.endsWith('sub/c.ts'),
					`Expected module under sub/, got: ${output.modules[0].path}`,
				);
			},
		);
	});

	test('--only is repeatable, unioning matches', async () => {
		await withTestProject(
			{
				'src/lib/a.ts': 'export const a = 1;',
				'src/lib/b.ts': 'export const b = 2;',
				'src/lib/c.ts': 'export const c = 3;',
				'tsconfig.json': JSON.stringify({compilerOptions: {}}),
			},
			async (projectRoot) => {
				const {exitCode, stdout} = await runCliCapture([
					'node',
					'svelte-docinfo',
					projectRoot,
					'--only',
					'a.ts',
					'--only',
					'c.ts',
					'--quiet',
				]);

				assert.strictEqual(exitCode, 0);

				const output = JSON.parse(stdout.join('\n'));
				const paths = output.modules.map((m: {path: string}) => m.path).sort();
				assert.deepStrictEqual(paths, ['a.ts', 'c.ts']);
			},
		);
	});

	test('--only with no matches emits empty modules array', async () => {
		await withTestProject(SIMPLE_PROJECT, async (projectRoot) => {
			const {exitCode, stdout} = await runCliCapture([
				'node',
				'svelte-docinfo',
				projectRoot,
				'--only',
				'nope/**',
				'--quiet',
			]);

			assert.strictEqual(exitCode, 0);

			// Empty `modules` is stripped by `compactReplacer` — parse through
			// the schema to restore the default and assert on the symmetric envelope.
			const output = AnalyzeResultJson.parse(JSON.parse(stdout.join('\n')));
			assert.deepStrictEqual(output.modules, []);
		});
	});

	test('--only does not filter diagnostics', async () => {
		// Set up a project where analysis surfaces a diagnostic from a module
		// `--only` will drop. The duplicate_declaration diagnostic survives the
		// output filter, proving the contract documented in --help.
		await withTestProject(
			{
				'src/lib/a.ts': 'export const dup = 1;',
				'src/lib/b.ts': 'export const dup = 2;',
				'src/lib/wanted.ts': 'export const wanted = 3;',
				'tsconfig.json': JSON.stringify({compilerOptions: {}}),
			},
			async (projectRoot) => {
				const {exitCode, stdout} = await runCliCapture([
					'node',
					'svelte-docinfo',
					projectRoot,
					'--only',
					'wanted.ts',
					'--quiet',
				]);

				assert.strictEqual(exitCode, 0);

				const output = AnalyzeResultJson.parse(JSON.parse(stdout.join('\n')));
				const [only_module] = output.modules;
				assert.ok(only_module, 'Expected exactly one module to survive --only');
				assert.strictEqual(output.modules.length, 1);
				assert.ok(only_module.path.endsWith('wanted.ts'));
				assert.ok(
					output.diagnostics.some((d) => d.kind === 'duplicate_declaration'),
					`Expected duplicate_declaration diagnostic to pass through --only filter, got: ${JSON.stringify(output.diagnostics)}`,
				);
			},
		);
	});

	test('--only composes with --include (analyzes filtered set, then filters output)', async () => {
		await withTestProject(
			{
				'src/lib/a.ts': 'export const a = 1;',
				'src/other/b.ts': 'export const b = 2;',
				'src/other/c.ts': 'export const c = 3;',
				'tsconfig.json': JSON.stringify({compilerOptions: {}}),
			},
			async (projectRoot) => {
				const {exitCode, stdout} = await runCliCapture([
					'node',
					'svelte-docinfo',
					projectRoot,
					'--include',
					'src/other/**/*.ts',
					'--source-dir',
					'src/other',
					'--only',
					'b.ts',
					'--quiet',
				]);

				assert.strictEqual(exitCode, 0);

				const output = JSON.parse(stdout.join('\n'));
				assert.strictEqual(output.modules.length, 1);
				assert.ok(output.modules[0].path.endsWith('b.ts'));
			},
		);
	});

	test('--discovery rejects invalid values', async () => {
		await withTestProject(SIMPLE_PROJECT, async (projectRoot) => {
			const {exitCode, stderr} = await runCliCapture([
				'node',
				'svelte-docinfo',
				projectRoot,
				'--discovery',
				'bogus',
				'--quiet',
			]);

			assert.strictEqual(exitCode, 2);
			assert.ok(
				stderr.some((e) => e.includes('Invalid --discovery')),
				`Expected validation error for --discovery, got: ${stderr.join('; ')}`,
			);
		});
	});
});

// CLI path for subprocess tests (requires `gro build` to exist)
const CLI_PATH = join(PROJECT_ROOT, 'dist/main.js');

describe('runCli (subprocess tests)', () => {
	beforeAll(() => {
		if (!existsSync(CLI_PATH)) {
			throw new Error(`dist/main.js not found — run \`npm run build\` first`);
		}
	});

	test('--help shows usage information, flags, and examples', async () => {
		const result = await runNodeSubprocess(CLI_PATH, ['--help']);

		assert.strictEqual(result.code, 0, `Help should exit with code 0\nstderr: ${result.stderr}`);
		assert.ok(
			result.stdout.includes('svelte-docinfo'),
			`Help output should mention command name, got: ${result.stdout}`,
		);
		assert.ok(
			result.stdout.includes('--output') || result.stdout.includes('-o'),
			'Help output should mention --output flag',
		);
		assert.ok(
			result.stdout.includes('--include') || result.stdout.includes('-i'),
			'Help output should mention --include flag',
		);
		assert.ok(result.stdout.includes('--pretty'), 'Help should mention --pretty');
		assert.ok(result.stdout.includes('Examples:'), 'Help should show examples section');
	});

	test('--version shows version number', async () => {
		const result = await runNodeSubprocess(CLI_PATH, ['--version']);

		assert.strictEqual(result.code, 0, `Version should exit with code 0\nstderr: ${result.stderr}`);
		assert.ok(
			/^\d+\.\d+\.\d+/.test(result.stdout.trim()),
			`Version output should be semver format, got: "${result.stdout.trim()}"`,
		);
	});

	test('-V shows version number (short flag)', async () => {
		const result = await runNodeSubprocess(CLI_PATH, ['-V']);

		assert.strictEqual(result.code, 0, `-V should exit with code 0\nstderr: ${result.stderr}`);
		assert.ok(
			/^\d+\.\d+\.\d+/.test(result.stdout.trim()),
			`Version output should be semver format, got: "${result.stdout.trim()}"`,
		);
	});

	test('-h shows help (short flag)', async () => {
		const result = await runNodeSubprocess(CLI_PATH, ['-h']);

		assert.strictEqual(result.code, 0, `-h should exit with code 0\nstderr: ${result.stderr}`);
		assert.ok(result.stdout.includes('svelte-docinfo'), 'Help output should mention command name');
	});
});

describe('runCli (default project root)', () => {
	test('uses current working directory when no path argument provided', async () => {
		// Run without project path - should use cwd (which is this project)
		const {exitCode, stdout} = await runCliCapture(['node', 'svelte-docinfo', '--quiet']);

		assert.strictEqual(exitCode, 0, 'Should succeed with cwd as project root');
		assert.ok(stdout.length > 0, 'Should produce output');

		const output = JSON.parse(stdout.join('\n'));
		assert.ok('modules' in output, 'Output should have modules');
		assert.ok(Array.isArray(output.modules), 'modules should be an array');
		assert.ok(output.modules.length > 0, 'Should find modules in current project');
	});
});
