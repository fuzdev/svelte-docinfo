/**
 * Tests for `loadTsconfig` and `createAnalysisLanguageService` handle behavior.
 *
 * The program-integration paths (virtual files, `.svelte` resolution) are
 * covered in `svelte-program.test.ts`; this file covers the module's own
 * surface.
 */

import { join } from 'node:path';
import { test, assert, describe } from 'vitest';

import {
	createAnalysisLanguageService,
	createOwnedDirIndex,
	loadTsconfig
} from '$lib/typescript-program.ts';

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
});

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
