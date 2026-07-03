import {test, assert, describe} from 'vitest';
import {writeFile, mkdir, chmod} from 'node:fs/promises';
import {join} from 'node:path';

import {parsePackageExports, mapDistToSource, discoverFromExports} from '$lib/exports.ts';

import {withTestDir} from './test-helpers.ts';

describe('parsePackageExports', () => {
	test('parses object conditions', async () => {
		await withTestDir(async (dir) => {
			await writeFile(
				join(dir, 'package.json'),
				JSON.stringify({
					exports: {
						'.': {types: './dist/index.d.ts', default: './dist/index.js'},
					},
				}),
			);

			const result = await parsePackageExports(dir);
			assert.ok(result.hasExports);
			assert.strictEqual(result.entries.length, 1);
			assert.strictEqual(result.entries[0]!.specifier, '.');
			assert.ok(!result.entries[0]!.isPattern);
			assert.strictEqual(result.entries[0]!.conditions.types, './dist/index.d.ts');
			assert.strictEqual(result.entries[0]!.conditions.default, './dist/index.js');
		});
	});

	test('parses wildcard patterns', async () => {
		await withTestDir(async (dir) => {
			await writeFile(
				join(dir, 'package.json'),
				JSON.stringify({
					exports: {
						'./*.js': {types: './dist/*.d.ts', default: './dist/*.js'},
					},
				}),
			);

			const result = await parsePackageExports(dir);
			assert.ok(result.hasExports);
			assert.strictEqual(result.entries.length, 1);
			assert.ok(result.entries[0]!.isPattern);
		});
	});

	test('skips ./package.json entry', async () => {
		await withTestDir(async (dir) => {
			await writeFile(
				join(dir, 'package.json'),
				JSON.stringify({
					exports: {
						'./package.json': './package.json',
						'.': {default: './dist/index.js'},
					},
				}),
			);

			const result = await parsePackageExports(dir);
			assert.ok(result.hasExports);
			assert.strictEqual(result.entries.length, 1);
			assert.strictEqual(result.entries[0]!.specifier, '.');
		});
	});

	test('skips null exclusions', async () => {
		await withTestDir(async (dir) => {
			await writeFile(
				join(dir, 'package.json'),
				JSON.stringify({
					exports: {
						'.': {default: './dist/index.js'},
						'./internal': null,
					},
				}),
			);

			const result = await parsePackageExports(dir);
			assert.ok(result.hasExports);
			assert.strictEqual(result.entries.length, 1);
		});
	});

	test('returns hasExports: false when no exports field', async () => {
		await withTestDir(async (dir) => {
			await writeFile(join(dir, 'package.json'), JSON.stringify({name: 'test'}));

			const result = await parsePackageExports(dir);
			assert.ok(!result.hasExports);
			assert.strictEqual(result.entries.length, 0);
		});
	});

	test('returns hasExports: false when no package.json', async () => {
		await withTestDir(async (dir) => {
			const result = await parsePackageExports(dir);
			assert.ok(!result.hasExports);
		});
	});

	test('parses string export value', async () => {
		await withTestDir(async (dir) => {
			await writeFile(
				join(dir, 'package.json'),
				JSON.stringify({
					exports: {
						'.': './dist/index.js',
					},
				}),
			);

			const result = await parsePackageExports(dir);
			assert.ok(result.hasExports);
			assert.strictEqual(result.entries[0]!.conditions.default, './dist/index.js');
		});
	});

	test('parses mixed concrete and wildcard entries', async () => {
		await withTestDir(async (dir) => {
			await writeFile(
				join(dir, 'package.json'),
				JSON.stringify({
					exports: {
						'./package.json': './package.json',
						'.': {types: './dist/index.d.ts', default: './dist/index.js'},
						'./*.js': {types: './dist/*.d.ts', default: './dist/*.js'},
					},
				}),
			);

			const result = await parsePackageExports(dir);
			assert.ok(result.hasExports);
			assert.strictEqual(result.entries.length, 2);
			assert.ok(!result.entries[0]!.isPattern); // "."
			assert.ok(result.entries[1]!.isPattern); // "./*.js"
		});
	});
});

describe('mapDistToSource', () => {
	const defaults = {distDir: 'dist', sourceDir: 'src/lib'};

	test('maps .js to .ts for default condition', () => {
		const result = mapDistToSource('./dist/index.js', 'default', defaults);
		assert.strictEqual(result, 'src/lib/index.ts');
	});

	test('maps nested .js to .ts', () => {
		const result = mapDistToSource('./dist/utils/helpers.js', 'default', defaults);
		assert.strictEqual(result, 'src/lib/utils/helpers.ts');
	});

	test('keeps .svelte for svelte condition', () => {
		const result = mapDistToSource('./dist/Button.svelte', 'svelte', defaults);
		assert.strictEqual(result, 'src/lib/Button.svelte');
	});

	test('keeps .css extension', () => {
		const result = mapDistToSource('./dist/theme.css', 'default', defaults);
		assert.strictEqual(result, 'src/lib/theme.css');
	});

	test('returns null for types condition', () => {
		const result = mapDistToSource('./dist/index.d.ts', 'types', defaults);
		assert.isNull(result);
	});

	test('maps .json files to source', () => {
		const result = mapDistToSource('./dist/data.json', 'default', defaults);
		assert.strictEqual(result, 'src/lib/data.json');
	});

	test('maps .js to .ts for import condition', () => {
		const result = mapDistToSource('./dist/index.js', 'import', defaults);
		assert.strictEqual(result, 'src/lib/index.ts');
	});

	test('maps .js to .ts for require condition', () => {
		const result = mapDistToSource('./dist/index.js', 'require', defaults);
		assert.strictEqual(result, 'src/lib/index.ts');
	});

	test('returns null when path does not start with dist dir', () => {
		const result = mapDistToSource('./other/index.js', 'default', defaults);
		assert.isNull(result);
	});

	test('maps wildcard .js to .ts', () => {
		const result = mapDistToSource('./dist/*.js', 'default', defaults);
		assert.strictEqual(result, 'src/lib/*.ts');
	});

	test('respects custom dist and source dirs', () => {
		const custom = {distDir: 'build', sourceDir: 'src'};
		const result = mapDistToSource('./build/index.js', 'default', custom);
		assert.strictEqual(result, 'src/index.ts');
	});

	test('produces project-relative paths when sourceDir is empty', () => {
		// Empty `sourceDir` is the no-common-prefix sourcePaths contract
		// (`getSourceRoot` returns `''`). The result must be a relative path
		// (no leading slash) so downstream `resolve(projectRoot, ...)` produces
		// `projectRoot/foo.ts` rather than treating `/foo.ts` as absolute.
		const empty = {distDir: 'dist', sourceDir: ''};
		assert.strictEqual(mapDistToSource('./dist/lib/a.js', 'default', empty), 'lib/a.ts');
		assert.strictEqual(mapDistToSource('./dist/index.js', 'default', empty), 'index.ts');
		assert.strictEqual(mapDistToSource('./dist/*.js', 'default', empty), '*.ts');
	});
});

describe('condition priority via mapDistToSource', () => {
	test('svelte condition wins over default', async () => {
		await withTestDir(async (dir) => {
			await mkdir(join(dir, 'src/lib'), {recursive: true});
			await writeFile(join(dir, 'src/lib/Button.svelte'), '<div>A</div>');
			await writeFile(
				join(dir, 'package.json'),
				JSON.stringify({
					exports: {
						'./Button.svelte': {
							svelte: './dist/Button.svelte',
							default: './dist/Button.js',
						},
					},
				}),
			);

			const {files} = await discoverFromExports({projectRoot: dir});
			assert.ok(files);
			assert.strictEqual(files.length, 1);
			// svelte condition selected → maps to .svelte, not .ts
			assert.ok(files[0]!.id.endsWith('Button.svelte'));
		});
	});

	test('default condition wins over import', async () => {
		await withTestDir(async (dir) => {
			await mkdir(join(dir, 'src/lib'), {recursive: true});
			await writeFile(join(dir, 'src/lib/index.ts'), 'export const a = 1;');
			await writeFile(
				join(dir, 'package.json'),
				JSON.stringify({
					exports: {
						'.': {
							types: './dist/index.d.ts',
							import: './dist/index.mjs',
							default: './dist/index.js',
						},
					},
				}),
			);

			const {files} = await discoverFromExports({projectRoot: dir});
			assert.ok(files);
			assert.strictEqual(files.length, 1);
			// default condition selected over import
			assert.ok(files[0]!.id.endsWith('index.ts'));
		});
	});

	test('import condition wins over require', async () => {
		await withTestDir(async (dir) => {
			await mkdir(join(dir, 'src/lib'), {recursive: true});
			await writeFile(join(dir, 'src/lib/index.ts'), 'export const a = 1;');
			await writeFile(
				join(dir, 'package.json'),
				JSON.stringify({
					exports: {
						'.': {
							types: './dist/index.d.ts',
							import: './dist/index.js',
							require: './dist/index.cjs',
						},
					},
				}),
			);

			const {files} = await discoverFromExports({projectRoot: dir});
			assert.ok(files);
			assert.strictEqual(files.length, 1);
			// import condition selected over require
			assert.ok(files[0]!.id.endsWith('index.ts'));
		});
	});
});

describe('discoverFromExports', () => {
	test('discovers concrete exports', async () => {
		await withTestDir(async (dir) => {
			await mkdir(join(dir, 'src/lib'), {recursive: true});
			await writeFile(join(dir, 'src/lib/index.ts'), 'export const a = 1;');
			await writeFile(
				join(dir, 'package.json'),
				JSON.stringify({
					exports: {
						'.': {types: './dist/index.d.ts', default: './dist/index.js'},
					},
				}),
			);

			const {files} = await discoverFromExports({projectRoot: dir});
			assert.ok(files);
			assert.strictEqual(files.length, 1);
			assert.ok(files[0]!.id.endsWith('src/lib/index.ts'));
			assert.strictEqual(files[0]!.content, 'export const a = 1;');
		});
	});

	test('discovers source files at project root when sourceDir is empty', async () => {
		// Mirrors the no-common-prefix sourcePaths case (e.g. ['lib', 'utils']):
		// `getSourceRoot` returns `''` and discovery must still find sources.
		await withTestDir(async (dir) => {
			await mkdir(join(dir, 'lib'), {recursive: true});
			await mkdir(join(dir, 'utils'), {recursive: true});
			await writeFile(join(dir, 'lib/a.ts'), 'export const a = 1;');
			await writeFile(join(dir, 'utils/b.ts'), 'export const b = 2;');
			await writeFile(
				join(dir, 'package.json'),
				JSON.stringify({
					exports: {
						'./a': {default: './dist/lib/a.js'},
						'./b': {default: './dist/utils/b.js'},
					},
				}),
			);

			const {files} = await discoverFromExports({projectRoot: dir, sourceDir: ''});
			assert.ok(files);
			assert.strictEqual(files.length, 2);
			const paths = files.map((f) => f.id).sort();
			assert.ok(paths[0]!.endsWith('lib/a.ts'));
			assert.ok(paths[1]!.endsWith('utils/b.ts'));
		});
	});

	test('discovers wildcard exports', async () => {
		await withTestDir(async (dir) => {
			await mkdir(join(dir, 'src/lib'), {recursive: true});
			await writeFile(join(dir, 'src/lib/a.ts'), 'export const a = 1;');
			await writeFile(join(dir, 'src/lib/b.ts'), 'export const b = 2;');
			await writeFile(
				join(dir, 'package.json'),
				JSON.stringify({
					exports: {
						'./*.js': {types: './dist/*.d.ts', default: './dist/*.js'},
					},
				}),
			);

			const {files} = await discoverFromExports({projectRoot: dir});
			assert.ok(files);
			assert.strictEqual(files.length, 2);
			const paths = files.map((f) => f.id).sort();
			assert.ok(paths[0]!.endsWith('src/lib/a.ts'));
			assert.ok(paths[1]!.endsWith('src/lib/b.ts'));
		});
	});

	test('discovers wildcard exports in nested directories', async () => {
		// A package.json `exports` wildcard (`./*.js`) matches subpaths including
		// `/` — `@scope/pkg/auth/session.js` resolves through it — so discovery
		// must recurse into subdirectories, not just the top-level source dir.
		await withTestDir(async (dir) => {
			await mkdir(join(dir, 'src/lib/auth'), {recursive: true});
			await mkdir(join(dir, 'src/lib/db/deep'), {recursive: true});
			await writeFile(join(dir, 'src/lib/root.ts'), 'export const r = 0;');
			await writeFile(join(dir, 'src/lib/auth/session.ts'), 'export const s = 1;');
			await writeFile(join(dir, 'src/lib/auth/Login.svelte'), '<div>login</div>');
			await writeFile(join(dir, 'src/lib/db/deep/nested.ts'), 'export const n = 2;');
			await writeFile(
				join(dir, 'package.json'),
				JSON.stringify({
					exports: {
						'./*.js': {types: './dist/*.d.ts', default: './dist/*.js'},
						'./*.svelte': {svelte: './dist/*.svelte', default: './dist/*.svelte'},
					},
				}),
			);

			const {files} = await discoverFromExports({projectRoot: dir});
			assert.ok(files);
			const paths = files.map((f) => f.id).sort();
			assert.strictEqual(files.length, 4);
			assert.ok(paths.some((p) => p.endsWith('src/lib/root.ts')));
			assert.ok(paths.some((p) => p.endsWith('src/lib/auth/session.ts')));
			assert.ok(paths.some((p) => p.endsWith('src/lib/auth/Login.svelte')));
			assert.ok(paths.some((p) => p.endsWith('src/lib/db/deep/nested.ts')));
		});
	});

	test('honors exclude for nested wildcard matches', async () => {
		// Recursive wildcard expansion means `exclude` now governs nested files
		// that a non-recursive `src/lib/*.ts` glob never reached. A co-located
		// test file (or any excluded subtree) must still be dropped.
		await withTestDir(async (dir) => {
			await mkdir(join(dir, 'src/lib/auth'), {recursive: true});
			await writeFile(join(dir, 'src/lib/auth/session.ts'), 'export const s = 1;');
			await writeFile(join(dir, 'src/lib/auth/session.test.ts'), 'export const t = 1;');
			await writeFile(
				join(dir, 'package.json'),
				JSON.stringify({
					exports: {'./*.js': {types: './dist/*.d.ts', default: './dist/*.js'}},
				}),
			);

			const {files} = await discoverFromExports({
				projectRoot: dir,
				exclude: ['**/*.test.ts'],
			});
			assert.ok(files);
			assert.strictEqual(files.length, 1);
			assert.ok(files[0]!.id.endsWith('src/lib/auth/session.ts'));
		});
	});

	test('bare-root wildcard (empty sourceDir) does not recurse into subdirectories', async () => {
		// Guard the deliberate non-widening: an empty `sourceDir` maps `./dist/*.js`
		// to a bare `*.ts`. Widening that to a project-root `**` would rake in
		// `node_modules`/`dist`, so it must stay a single-segment match. Only the
		// root-level file is found; the nested one is not.
		await withTestDir(async (dir) => {
			await mkdir(join(dir, 'nested'), {recursive: true});
			await writeFile(join(dir, 'root.ts'), 'export const r = 0;');
			await writeFile(join(dir, 'nested/deep.ts'), 'export const d = 1;');
			await writeFile(
				join(dir, 'package.json'),
				JSON.stringify({
					exports: {'./*.js': {types: './dist/*.d.ts', default: './dist/*.js'}},
				}),
			);

			const {files} = await discoverFromExports({projectRoot: dir, sourceDir: ''});
			assert.ok(files);
			assert.strictEqual(files.length, 1);
			assert.ok(files[0]!.id.endsWith('root.ts'));
			assert.ok(!files.some((f) => f.id.endsWith('deep.ts')));
		});
	});

	test('deduplicates across .js and .ts patterns', async () => {
		await withTestDir(async (dir) => {
			await mkdir(join(dir, 'src/lib'), {recursive: true});
			await writeFile(join(dir, 'src/lib/a.ts'), 'export const a = 1;');
			await writeFile(
				join(dir, 'package.json'),
				JSON.stringify({
					exports: {
						'./*.js': {types: './dist/*.d.ts', default: './dist/*.js'},
						'./*.ts': {types: './dist/*.d.ts', default: './dist/*.js'},
					},
				}),
			);

			const {files} = await discoverFromExports({projectRoot: dir});
			assert.ok(files);
			assert.strictEqual(files.length, 1);
		});
	});

	test('discovers Svelte files from wildcard', async () => {
		await withTestDir(async (dir) => {
			await mkdir(join(dir, 'src/lib'), {recursive: true});
			await writeFile(join(dir, 'src/lib/A.svelte'), '<div>A</div>');
			await writeFile(join(dir, 'src/lib/a.ts'), 'export const a = 1;');
			await writeFile(
				join(dir, 'package.json'),
				JSON.stringify({
					exports: {
						'./*.js': {types: './dist/*.d.ts', default: './dist/*.js'},
					},
				}),
			);

			const {files} = await discoverFromExports({projectRoot: dir});
			assert.ok(files);
			// Should find both .ts and .svelte files
			assert.strictEqual(files.length, 2);
			const paths = files.map((f) => f.id).sort();
			assert.ok(paths.some((p) => p.endsWith('.svelte')));
			assert.ok(paths.some((p) => p.endsWith('.ts')));
		});
	});

	test('returns null when no package.json', async () => {
		await withTestDir(async (dir) => {
			const {files} = await discoverFromExports({projectRoot: dir});
			assert.isNull(files);
		});
	});

	test('returns null when no exports field', async () => {
		await withTestDir(async (dir) => {
			await writeFile(join(dir, 'package.json'), JSON.stringify({name: 'test'}));
			const {files} = await discoverFromExports({projectRoot: dir});
			assert.isNull(files);
		});
	});

	test('returns empty array when no source files match', async () => {
		await withTestDir(async (dir) => {
			await writeFile(
				join(dir, 'package.json'),
				JSON.stringify({
					exports: {
						'.': {default: './dist/index.js'},
					},
				}),
			);
			// No src/lib/index.ts exists
			const {files} = await discoverFromExports({projectRoot: dir});
			assert.isNotNull(files);
			assert.deepEqual(files, []);
		});
	});

	test('respects custom sourceDir', async () => {
		await withTestDir(async (dir) => {
			await mkdir(join(dir, 'src'), {recursive: true});
			await writeFile(join(dir, 'src/index.ts'), 'export const a = 1;');
			await writeFile(
				join(dir, 'package.json'),
				JSON.stringify({
					exports: {
						'.': {default: './dist/index.js'},
					},
				}),
			);

			const {files} = await discoverFromExports({projectRoot: dir, sourceDir: 'src'});
			assert.ok(files);
			assert.strictEqual(files.length, 1);
		});
	});

	test('returns error diagnostics for unreadable files', async () => {
		await withTestDir(async (dir) => {
			const sourceFile = join(dir, 'src/lib/index.ts');
			await mkdir(join(dir, 'src/lib'), {recursive: true});
			await writeFile(sourceFile, 'export const a = 1;');
			await writeFile(
				join(dir, 'package.json'),
				JSON.stringify({
					exports: {
						'.': {default: './dist/index.js'},
						'./util': {default: './dist/util.js'},
					},
				}),
			);
			// Second file so files is not null
			await writeFile(join(dir, 'src/lib/util.ts'), 'export const b = 2;');

			// Remove read permission — file exists but readFile() fails
			await chmod(sourceFile, 0o111);

			try {
				const {files, diagnostics} = await discoverFromExports({projectRoot: dir});

				// Only the readable file should be returned
				assert.ok(files);
				assert.strictEqual(files.length, 1);

				// Diagnostics should contain an error for the unreadable file
				assert.strictEqual(diagnostics.length, 1);
				assert.strictEqual(diagnostics[0]!.kind, 'module_unreadable');
				assert.strictEqual(diagnostics[0]!.severity, 'error');
			} finally {
				await chmod(sourceFile, 0o644).catch(() => undefined);
			}
		});
	});
});
