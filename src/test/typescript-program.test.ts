/**
 * Tests for `loadTsconfig` and `createAnalysisLanguageService` handle behavior.
 *
 * The program-integration paths (virtual files, `.svelte` resolution) are
 * covered in `svelte-program.test.ts`; this file covers the module's own
 * surface.
 */

import { test, assert, describe } from 'vitest';

import { createAnalysisLanguageService, loadTsconfig } from '$lib/typescript-program.ts';

import { withTestProject } from './test-helpers.ts';

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
});
