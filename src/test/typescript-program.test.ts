/**
 * Tests for `loadTsconfig` and `createAnalysisLanguageService` handle behavior,
 * and for the options both program paths run with (`allowJs` forced on).
 *
 * The program-integration paths (virtual files, `.svelte` resolution) are
 * covered in `svelte-program.test.ts`; this file covers the module's own
 * surface.
 */

import { join } from 'node:path';
import { test, assert, describe } from 'vitest';

import {
	DEFAULT_COMPILER_OPTIONS,
	createAnalysisLanguageService,
	createAnalysisProgram,
	createOwnedDirIndex,
	declarationFileRoots,
	loadTsconfig
} from '#lib/typescript-program.ts';

import { withTestProject } from './test-helpers.ts';

describe('createOwnedDirIndex', () => {
	test('reports every ancestor of an indexed path, exclusive of the root', () => {
		const index = createOwnedDirIndex();
		index.add('/a/b/c/f.ts');
		assert.ok(index.has('/a/b/c'));
		assert.ok(index.has('/a/b'));
		assert.ok(index.has('/a'));
		assert.ok(!index.has('/a/b/c/d'));
		assert.ok(!index.has('/a/b/c/f.ts'));
	});

	test('tolerates a trailing slash on the probe', () => {
		const index = createOwnedDirIndex();
		index.add('/a/b/f.ts');
		assert.ok(index.has('/a/b/'));
		assert.ok(!index.has('/'));
	});

	test('removal is exact — a shared ancestor survives while any path holds it', () => {
		const index = createOwnedDirIndex();
		index.add('/a/b/f1.ts');
		index.add('/a/b/f2.ts');
		index.remove('/a/b/f1.ts');
		assert.ok(index.has('/a/b'), 'ancestor dropped while a sibling still holds it');
		index.remove('/a/b/f2.ts');
		assert.ok(!index.has('/a/b'));
		assert.ok(!index.has('/a'));
	});

	test('add and remove are idempotent, so a caller cannot skew the refcounts', () => {
		// The guards live here rather than in each caller: a double add or a
		// remove of something never added would otherwise unbalance an ancestor
		// that live paths still need.
		const index = createOwnedDirIndex();
		index.add('/a/b/f1.ts');
		index.add('/a/b/f1.ts');
		index.remove('/a/b/f1.ts');
		assert.ok(!index.has('/a/b'), 'double add left an unbalanced count');

		index.add('/a/b/f2.ts');
		index.remove('/a/b/never-added.ts');
		assert.ok(index.has('/a/b'), 'removing an unindexed path decremented a live ancestor');
	});

	test('clear drops everything', () => {
		const index = createOwnedDirIndex();
		index.add('/a/b/f.ts');
		index.clear();
		assert.ok(!index.has('/a/b'));
		// re-adding after clear starts from zero rather than a stale count
		index.add('/a/b/f.ts');
		index.remove('/a/b/f.ts');
		assert.ok(!index.has('/a/b'));
	});
});

describe('loadTsconfig', () => {
	test('throws when the requested tsconfig is not found', async () => {
		// A distinctive name so `ts.findConfigFile`'s upward directory walk
		// can't collide with a real config outside the temp project.
		await withTestProject({}, async (projectRoot) => {
			assert.throws(
				() => loadTsconfig({ projectRoot, tsconfig: 'tsconfig.does-not-exist.json' }),
				/tsconfig\.does-not-exist\.json/
			);
		});
	});

	test('custom tsconfig name resolves', async () => {
		await withTestProject(
			{ 'custom.tsconfig.json': '{"compilerOptions": {"strict": true}}' },
			async (projectRoot) => {
				const { compilerOptions } = loadTsconfig({
					projectRoot,
					tsconfig: 'custom.tsconfig.json'
				});
				assert.strictEqual(compilerOptions.strict, true);
			},
			{ tsconfig: false }
		);
	});

	test('rootFileNames include the project source files', async () => {
		await withTestProject({ 'src/lib/a.ts': 'export const a = 1;' }, async (projectRoot) => {
			const { rootFileNames } = loadTsconfig({ projectRoot });
			assert.ok(rootFileNames.some((f) => f.endsWith('src/lib/a.ts')));
		});
	});

	describe('extends chain', () => {
		test('inherits options from a resolved extends target', async () => {
			await withTestProject(
				{
					'tsconfig.json': '{"extends": "./base.json"}',
					'base.json': '{"compilerOptions": {"lib": ["ESNext", "DOM"]}}',
					'src/lib/a.ts': 'export const a = 1;'
				},
				async (projectRoot) => {
					const { compilerOptions } = loadTsconfig({ projectRoot });
					assert.deepStrictEqual(compilerOptions.lib, ['lib.esnext.d.ts', 'lib.dom.d.ts']);
				}
			);
		});

		// SvelteKit writes `node_modules/$app/tsconfig.json` during `svelte-kit
		// sync`; a clone that was installed but never synced lacks it, and
		// TypeScript would drop the inherited `lib`/`types`/`rootDirs` silently.
		test('missing `$app/tsconfig` throws with a `svelte-kit sync` hint', async () => {
			await withTestProject(
				{
					'tsconfig.json': '{"extends": "$app/tsconfig"}',
					'src/lib/a.ts': 'export const a = 1;'
				},
				async (projectRoot) => {
					assert.throws(
						() => loadTsconfig({ projectRoot }),
						/tsconfig\.json: TS6053: File '\$app\/tsconfig' not found\..*svelte-kit sync/
					);
				}
			);
		});

		test('missing `$app/tsconfig` deeper in the chain still throws with the hint', async () => {
			await withTestProject(
				{
					'tsconfig.json': '{"extends": "./base.json"}',
					'base.json': '{"extends": "$app/tsconfig"}',
					'src/lib/a.ts': 'export const a = 1;'
				},
				async (projectRoot) => {
					assert.throws(
						() => loadTsconfig({ projectRoot }),
						/TS6053 in .*base\.json: File '\$app\/tsconfig' not found\..*svelte-kit sync/
					);
				}
			);
		});

		test('missing package extends throws without the SvelteKit hint', async () => {
			await withTestProject(
				{
					'tsconfig.json': '{"extends": "@svelte-docinfo-test/missing/tsconfig.json"}',
					'src/lib/a.ts': 'export const a = 1;'
				},
				async (projectRoot) => {
					const error = assertThrows(() => loadTsconfig({ projectRoot }));
					assert.include(error.message, join(projectRoot, 'tsconfig.json'));
					assert.include(error.message, "'@svelte-docinfo-test/missing/tsconfig.json'");
					assert.include(error.message, 'TS6053');
					assert.notInclude(error.message, 'svelte-kit sync');
				}
			);
		});

		test('missing relative extends throws', async () => {
			await withTestProject(
				{
					'tsconfig.json': '{"extends": "./missing-base.json"}',
					'src/lib/a.ts': 'export const a = 1;'
				},
				async (projectRoot) => {
					const error = assertThrows(() => loadTsconfig({ projectRoot }));
					assert.include(error.message, 'TS5083');
					assert.include(error.message, 'missing-base.json');
					assert.notInclude(error.message, 'svelte-kit sync');
				}
			);
		});

		test('an extended config that is not valid JSON throws', async () => {
			await withTestProject(
				{
					'tsconfig.json': '{"extends": "./base.json"}',
					'base.json': '{"compilerOptions": {,}',
					'src/lib/a.ts': 'export const a = 1;'
				},
				async (projectRoot) => {
					assert.throws(() => loadTsconfig({ projectRoot }), /TS1\d{3} in .*base\.json/);
				}
			);
		});

		test('an extended config whose root is not an object throws (TS5092)', async () => {
			await withTestProject(
				{
					'tsconfig.json': '{"extends": "./base.json"}',
					'base.json': '[]',
					'src/lib/a.ts': 'export const a = 1;'
				},
				async (projectRoot) => {
					assert.throws(() => loadTsconfig({ projectRoot }), /TS5092/);
				}
			);
		});

		// SvelteKit 2 writes `.svelte-kit/tsconfig.json` during `svelte-kit sync`
		test('missing `.svelte-kit/tsconfig.json` throws with a `svelte-kit sync` hint', async () => {
			await withTestProject(
				{
					'tsconfig.json': '{"extends": "./.svelte-kit/tsconfig.json"}',
					'src/lib/a.ts': 'export const a = 1;'
				},
				async (projectRoot) => {
					assert.throws(
						() => loadTsconfig({ projectRoot }),
						/TS5083: .*\.svelte-kit\/tsconfig\.json.*svelte-kit sync/
					);
				}
			);
		});

		// `ts.findConfigFile` walks up from `projectRoot`, so the config's
		// relative paths must resolve from its own directory, not `projectRoot`
		test('relative extends and include resolve from a config found by walking up', async () => {
			await withTestProject(
				{
					'tsconfig.json': '{"extends": "./base.json", "include": ["src/**/*.ts"]}',
					'base.json': '{"compilerOptions": {"lib": ["ESNext", "DOM"]}}',
					'src/lib/a.ts': 'export const a = 1;'
				},
				async (root) => {
					const { compilerOptions, rootFileNames } = loadTsconfig({
						projectRoot: join(root, 'src')
					});
					assert.deepStrictEqual(compilerOptions.lib, ['lib.esnext.d.ts', 'lib.dom.d.ts']);
					assert.ok(rootFileNames.some((f) => f.endsWith('src/lib/a.ts')));
				}
			);
		});

		test('relative extends resolves from a `tsconfig` option in a subdirectory', async () => {
			await withTestProject(
				{
					'config/tsconfig.json': '{"extends": "./base.json"}',
					'config/base.json': '{"compilerOptions": {"strict": true}}'
				},
				async (projectRoot) => {
					const { compilerOptions } = loadTsconfig({
						projectRoot,
						tsconfig: 'config/tsconfig.json'
					});
					assert.strictEqual(compilerOptions.strict, true);
				},
				{ tsconfig: false }
			);
		});
	});

	describe('tsconfig: false', () => {
		test('loads without a config file, on the documented defaults', async () => {
			await withTestProject(
				{ 'src/lib/a.ts': 'export const a = 1;' },
				async (projectRoot) => {
					const { compilerOptions, rootFileNames } = loadTsconfig({ projectRoot, tsconfig: false });
					assert.deepStrictEqual(compilerOptions, DEFAULT_COMPILER_OPTIONS);
					assert.strictEqual(compilerOptions.strict, true);
					assert.deepStrictEqual(rootFileNames, []);
				},
				{ tsconfig: false }
			);
		});

		test('ignores a config file that exists', async () => {
			await withTestProject(
				{
					'tsconfig.json': '{"compilerOptions": {"strict": false}, "include": ["src/**/*.ts"]}',
					'src/lib/a.ts': 'export const a = 1;'
				},
				async (projectRoot) => {
					const { compilerOptions, rootFileNames } = loadTsconfig({ projectRoot, tsconfig: false });
					assert.strictEqual(compilerOptions.strict, true);
					assert.deepStrictEqual(rootFileNames, []);
				}
			);
		});

		test('compilerOptions merge over the defaults per key', async () => {
			await withTestProject(
				{},
				async (projectRoot) => {
					const { compilerOptions } = loadTsconfig({
						projectRoot,
						tsconfig: false,
						compilerOptions: { checkJs: false, noUncheckedIndexedAccess: true }
					});
					assert.deepStrictEqual(compilerOptions, {
						...DEFAULT_COMPILER_OPTIONS,
						checkJs: false,
						noUncheckedIndexedAccess: true
					});
				},
				{ tsconfig: false }
			);
		});

		test('a missing config still throws without it', async () => {
			await withTestProject(
				{},
				async (projectRoot) => {
					assert.throws(
						() => loadTsconfig({ projectRoot, tsconfig: 'tsconfig.does-not-exist.json' }),
						/tsconfig\.does-not-exist\.json/
					);
				},
				{ tsconfig: false }
			);
		});
	});

	describe('rootFileNames', () => {
		const files = {
			'src/app.d.ts': 'declare global {\n\ttype Ambient = 1;\n}\nexport {};',
			'src/lib/a.ts': 'export const a = 1;',
			'src/lib/b.ts': 'export const b = 2;'
		};

		test('declarationFileRoots keeps every declaration-file suffix and nothing else', () => {
			assert.deepStrictEqual(
				declarationFileRoots([
					'/p/a.d.ts',
					'/p/b.ts',
					'/p/c.d.mts',
					'/p/d.d.cts',
					'/p/e.svelte',
					'/p/d.ts'
				]),
				['/p/a.d.ts', '/p/c.d.mts', '/p/d.d.cts']
			);
		});

		test('a function filters the tsconfig roots', async () => {
			await withTestProject(files, async (projectRoot) => {
				const { rootFileNames } = loadTsconfig({
					projectRoot,
					rootFileNames: (roots) => roots.filter((file) => file.endsWith('.d.ts'))
				});
				assert.deepStrictEqual(rootFileNames, [join(projectRoot, 'src/app.d.ts')]);
			});
		});

		test('a function cannot mutate the tsconfig roots it is handed', async () => {
			await withTestProject(files, async (projectRoot) => {
				const { rootFileNames } = loadTsconfig({
					projectRoot,
					rootFileNames: (roots) => {
						const kept = roots.slice();
						roots.length = 0;
						return kept;
					}
				});
				assert.deepStrictEqual(rootFileNames, loadTsconfig({ projectRoot }).rootFileNames);
			});
		});

		test('a list replaces the tsconfig roots, relative entries resolving against projectRoot', async () => {
			await withTestProject(files, async (projectRoot) => {
				const { rootFileNames } = loadTsconfig({
					projectRoot,
					rootFileNames: ['src/lib/b.ts', join(projectRoot, 'src/app.d.ts')]
				});
				assert.deepStrictEqual(rootFileNames, [
					join(projectRoot, 'src/lib/b.ts'),
					join(projectRoot, 'src/app.d.ts')
				]);
			});
		});

		test('an empty list roots nothing', async () => {
			await withTestProject(files, async (projectRoot) => {
				assert.deepStrictEqual(loadTsconfig({ projectRoot, rootFileNames: [] }).rootFileNames, []);
			});
		});

		test('under tsconfig: false a function receives no roots', async () => {
			await withTestProject(files, async (projectRoot) => {
				let received: Array<string> | undefined;
				const { rootFileNames } = loadTsconfig({
					projectRoot,
					tsconfig: false,
					rootFileNames: (roots) => {
						received = roots;
						return ['src/app.d.ts'];
					}
				});
				assert.deepStrictEqual(received, []);
				assert.deepStrictEqual(rootFileNames, [join(projectRoot, 'src/app.d.ts')]);
			});
		});

		test('the language service program takes the narrowed roots', async () => {
			await withTestProject(files, async (projectRoot) => {
				const ls = createAnalysisLanguageService({ projectRoot, rootFileNames: [] });
				try {
					assert.deepStrictEqual(ls.getProgram().getRootFileNames(), []);
					ls.setFile(join(projectRoot, 'src/lib/a.ts'), { content: files['src/lib/a.ts'] });
					assert.deepStrictEqual(ls.getProgram().getRootFileNames(), [
						join(projectRoot, 'src/lib/a.ts')
					]);
				} finally {
					ls.dispose();
				}
			});
		});
	});

	test('a tsconfig that is not valid JSON throws', async () => {
		await withTestProject(
			{ 'tsconfig.json': '{"compilerOptions": {,}', 'src/lib/a.ts': 'export const a = 1;' },
			async (projectRoot) => {
				assert.throws(() => loadTsconfig({ projectRoot }), /Failed to read .*tsconfig\.json: TS1/);
			}
		);
	});

	test('an include that matches no files does not throw (TS18003)', async () => {
		await withTestProject(
			{ 'tsconfig.json': '{"include": ["nothing/**/*.ts"]}' },
			async (projectRoot) => {
				const { rootFileNames } = loadTsconfig({ projectRoot });
				assert.deepStrictEqual(rootFileNames, []);
			}
		);
	});

	test('option-level diagnostics do not throw', async () => {
		// TS5023 (unknown option) leaves the rest of the config applied; the
		// project's own typecheck owns reporting it
		await withTestProject(
			{
				'tsconfig.json': '{"compilerOptions": {"notARealOption": true, "strict": true}}',
				'src/lib/a.ts': 'export const a = 1;'
			},
			async (projectRoot) => {
				const { compilerOptions } = loadTsconfig({ projectRoot });
				assert.strictEqual(compilerOptions.strict, true);
			}
		);
	});
});

const assertThrows = (fn: () => unknown): Error => {
	try {
		fn();
	} catch (error) {
		assert(error instanceof Error);
		return error;
	}
	assert.fail('expected a throw');
};

describe('createAnalysisLanguageService', () => {
	describe('getCompilerOptions', () => {
		test('returns options parsed from tsconfig.json', async () => {
			await withTestProject({}, async (projectRoot) => {
				const ls = createAnalysisLanguageService({ projectRoot });
				try {
					const options = ls.getCompilerOptions();
					// The default test tsconfig sets strict: true (see createTestProject).
					assert.strictEqual(options.strict, true);
				} finally {
					ls.dispose();
				}
			});
		});

		test('user-supplied compilerOptions merge per-key over the parsed tsconfig', async () => {
			await withTestProject({}, async (projectRoot) => {
				const ls = createAnalysisLanguageService({
					projectRoot,
					compilerOptions: { strict: false }
				});
				try {
					const options = ls.getCompilerOptions();
					// Override wins on the supplied key...
					assert.strictEqual(options.strict, false);
					// ...while non-overridden tsconfig keys survive.
					assert.ok(options.target !== undefined);
				} finally {
					ls.dispose();
				}
			});
		});

		test('forces allowJs on, leaving checkJs as configured', async () => {
			// the test tsconfig sets neither
			await withTestProject({}, async (projectRoot) => {
				const ls = createAnalysisLanguageService({ projectRoot });
				try {
					const options = ls.getCompilerOptions();
					assert.strictEqual(options.allowJs, true);
					assert.strictEqual(options.checkJs, undefined);
					assert.strictEqual(ls.getProgram().getCompilerOptions(), options);
				} finally {
					ls.dispose();
				}
			});
		});

		test('reference-stable across calls', async () => {
			await withTestProject({}, async (projectRoot) => {
				const ls = createAnalysisLanguageService({ projectRoot });
				try {
					assert.strictEqual(ls.getCompilerOptions(), ls.getCompilerOptions());
				} finally {
					ls.dispose();
				}
			});
		});
	});

	describe('owned files in directories absent from disk', () => {
		test('module resolution reaches an owned file whose directory exists nowhere on disk', async () => {
			await withTestProject({}, async (projectRoot) => {
				const ls = createAnalysisLanguageService({ projectRoot });
				try {
					// `virtual-only/` is never created on disk. Resolution probes
					// `directoryExists` before trying file candidates inside it, so a
					// disk-only answer records `./dep` as a failed lookup with
					// `fileExists` never consulted, and the import silently fails.
					const dir = join(projectRoot, 'src/lib/virtual-only');
					const mainPath = join(dir, 'main.ts');
					ls.setFile(join(dir, 'dep.ts'), { content: 'export const a = 1;' });
					ls.setFile(mainPath, {
						content: `import { a } from './dep';\nexport const b: number = a;`
					});
					const program = ls.getProgram();
					const main = program.getSourceFile(mainPath);
					assert.ok(main);
					const messages = program
						.getSemanticDiagnostics(main)
						.map((d) => JSON.stringify(d.messageText));
					assert.ok(
						!messages.some((m) => m.includes('Cannot find module')),
						`import failed to resolve: ${messages.join('; ')}`
					);
				} finally {
					ls.dispose();
				}
			});
		});
	});

	describe('setFile of a previously disk-resolved file', () => {
		test('first push reparses — the disk version sentinel cannot collide with owned version 1', async () => {
			const mainContent = `import { width } from './dep.ts';\nexport const w = width;`;
			await withTestProject(
				{
					'src/lib/dep.ts': 'export const width = 1;',
					'src/lib/main.ts': mainContent
				},
				async (projectRoot) => {
					const ls = createAnalysisLanguageService({ projectRoot });
					try {
						const depPath = join(projectRoot, 'src/lib/dep.ts');
						ls.setFile(join(projectRoot, 'src/lib/main.ts'), { content: mainContent });
						// dep.ts enters the program from disk (import target + tsconfig root).
						const before = ls.getProgram().getSourceFile(depPath);
						assert.ok(before);
						assert.match(before.text, /width = 1/);
						// The registry reparses only on a version-string change, so a
						// numeric disk sentinel would make this first push a silent
						// no-op ('1' → '1') and keep serving the stale disk AST.
						ls.setFile(depPath, { content: 'export const width = 2;' });
						const after = ls.getProgram().getSourceFile(depPath);
						assert.ok(after);
						assert.match(after.text, /width = 2/);
					} finally {
						ls.dispose();
					}
				}
			);
		});
	});
});

describe('createAnalysisProgram', () => {
	// the test tsconfig sets no `allowJs`
	test('serves a JS virtual file under a tsconfig without allowJs', async () => {
		await withTestProject({}, async (projectRoot) => {
			const jsPath = join(projectRoot, 'src/lib/a.js');
			const tsPath = join(projectRoot, 'src/lib/b.ts');
			const program = createAnalysisProgram({
				projectRoot,
				virtualFiles: new Map([
					[jsPath, { content: '/** @param {number} x */\nexport const fa = (x) => x + 1;' }],
					[tsPath, { content: "import {fa} from './a.js';\nexport const fb = fa;" }]
				])
			});
			assert.strictEqual(program.getCompilerOptions().allowJs, true);
			assert.ok(program.getSourceFile(jsPath), 'the JS file is in the program');
			const b = program.getSourceFile(tsPath);
			assert.ok(b);
			const checker = program.getTypeChecker();
			const fb = checker.getExportsOfModule(checker.getSymbolAtLocation(b)!)[0]!;
			assert.strictEqual(
				checker.typeToString(checker.getTypeOfSymbol(fb)),
				'(x: number) => number'
			);
		});
	});

	test('forces allowJs without virtual files too', async () => {
		await withTestProject({}, async (projectRoot) => {
			assert.strictEqual(createAnalysisProgram({ projectRoot }).getCompilerOptions().allowJs, true);
		});
	});
});
