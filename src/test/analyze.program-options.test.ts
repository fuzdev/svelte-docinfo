/**
 * Tests for the program options the analysis entry points forward to
 * `loadTsconfig`: `tsconfig` (a path, or `false` for none), `compilerOptions`,
 * and `rootFileNames`.
 *
 * `loadTsconfig`'s own handling of them is covered in
 * `typescript-program.test.ts`; this file locks what they do to analysis
 * output, and that `analyze`, `analyzeFromFiles`, and the session all honor
 * them.
 */

import { test, assert, describe } from 'vitest';
import { join } from 'node:path';

import { analyze, analyzeFromFiles } from '#lib/analyze.ts';
import { createAnalysisSession } from '#lib/session.ts';
import { createSourceOptions } from '#lib/source-config.ts';
import { declarationFileRoots } from '#lib/typescript-program.ts';
import type { AnalyzeResultJson } from '#lib/analyze-core.ts';

import { withTestProject } from './test-helpers.ts';

const typeOf = (result: AnalyzeResultJson, name: string): string | undefined => {
	for (const module of result.modules) {
		const declaration = module.declarations.find((d) => d.name === name);
		if (declaration) return declaration.typeSignature;
	}
	return undefined;
};

describe('tsconfig: false', { timeout: 15_000 }, () => {
	const files = {
		'src/lib/a.ts': 'export const nullable: string | null = null;'
	};

	test('analyzeFromFiles throws without a tsconfig by default', async () => {
		await withTestProject(
			files,
			async (projectRoot) => {
				let thrown: unknown;
				try {
					await analyzeFromFiles({ projectRoot });
				} catch (error) {
					thrown = error;
				}
				assert(thrown instanceof Error);
				assert.include(thrown.message, 'No tsconfig.json found');
			},
			{ tsconfig: false }
		);
	});

	test('analyzeFromFiles analyzes strictly with no config file', async () => {
		await withTestProject(
			files,
			async (projectRoot) => {
				const result = await analyzeFromFiles({ projectRoot, tsconfig: false });
				assert.deepStrictEqual(result.diagnostics, []);
				// strict null checks are on: `null` would vanish without them
				assert.strictEqual(typeOf(result, 'nullable'), 'string | null');
			},
			{ tsconfig: false }
		);
	});

	test('compilerOptions merge over the defaults', async () => {
		await withTestProject(
			files,
			async (projectRoot) => {
				const result = await analyzeFromFiles({
					projectRoot,
					tsconfig: false,
					compilerOptions: { strict: false }
				});
				assert.strictEqual(typeOf(result, 'nullable'), 'string');
			},
			{ tsconfig: false }
		);
	});

	test('analyze forwards it', async () => {
		await withTestProject(
			files,
			async (projectRoot) => {
				const result = await analyze({
					sourceFiles: [{ id: join(projectRoot, 'src/lib/a.ts'), content: files['src/lib/a.ts'] }],
					sourceOptions: createSourceOptions(projectRoot),
					tsconfig: false
				});
				assert.strictEqual(typeOf(result, 'nullable'), 'string | null');
			},
			{ tsconfig: false }
		);
	});
});

describe('tsconfig path', { timeout: 15_000 }, () => {
	test('analyzeFromFiles uses the named config', async () => {
		await withTestProject(
			{
				'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }),
				'tsconfig.loose.json': JSON.stringify({ compilerOptions: { strict: false } }),
				'src/lib/a.ts': 'export const nullable: string | null = null;'
			},
			async (projectRoot) => {
				const strict = await analyzeFromFiles({ projectRoot });
				assert.strictEqual(typeOf(strict, 'nullable'), 'string | null');
				const loose = await analyzeFromFiles({ projectRoot, tsconfig: 'tsconfig.loose.json' });
				assert.strictEqual(typeOf(loose, 'nullable'), 'string');
			}
		);
	});
});

describe('rootFileNames', { timeout: 15_000 }, () => {
	// `Ambient` reaches `a.ts` through no import: only a program root declares it
	const files = {
		'src/app.d.ts': `declare global {\n\ttype Ambient = 'x' | 'y';\n}\nexport {};`,
		'src/lib/a.ts': 'export const ambient: Ambient = null as any;'
	};

	test('the tsconfig roots resolve an ambient type by default', async () => {
		await withTestProject(files, async (projectRoot) => {
			const result = await analyzeFromFiles({ projectRoot });
			assert.strictEqual(typeOf(result, 'ambient'), 'Ambient');
			const declaration = result.modules[0]?.declarations[0];
			assert(declaration?.kind === 'variable');
			assert.strictEqual(declaration.typeInfo?.kind, 'union');
		});
	});

	test('keeping the declaration files keeps the ambient type', async () => {
		await withTestProject(files, async (projectRoot) => {
			const result = await analyzeFromFiles({
				projectRoot,
				rootFileNames: declarationFileRoots
			});
			const declaration = result.modules[0]?.declarations[0];
			assert(declaration?.kind === 'variable');
			assert.strictEqual(declaration.typeInfo?.kind, 'union');
		});
	});

	test('rooting nothing loses the ambient type', async () => {
		await withTestProject(files, async (projectRoot) => {
			const result = await analyzeFromFiles({ projectRoot, rootFileNames: [] });
			// the documented cost of dropping a root nothing imports: the type is
			// unresolved, so the checker has no union to describe
			const declaration = result.modules[0]?.declarations[0];
			assert(declaration?.kind === 'variable');
			assert.isUndefined(declaration.typeInfo);
		});
	});

	test('a session keeps unqueried project files out of the program', async () => {
		await withTestProject(
			{ ...files, 'src/lib/unrelated.ts': 'export const unrelated = 1;' },
			async (projectRoot) => {
				const aId = join(projectRoot, 'src/lib/a.ts');
				const unrelatedId = join(projectRoot, 'src/lib/unrelated.ts');
				const loaded = (rootFileNames?: Array<string>): boolean => {
					const session = createAnalysisSession({
						sourceOptions: createSourceOptions(projectRoot),
						rootFileNames
					});
					try {
						return session.getProgram().getSourceFile(unrelatedId) !== undefined;
					} finally {
						session.dispose();
					}
				};
				assert.isTrue(loaded());
				assert.isFalse(loaded([]));

				const session = createAnalysisSession({
					sourceOptions: createSourceOptions(projectRoot),
					rootFileNames: []
				});
				try {
					await session.setFile({ id: aId, content: files['src/lib/a.ts'] });
					assert.deepStrictEqual(
						session.query().modules.map((m) => m.path),
						['a.ts']
					);
					assert.isUndefined(session.getProgram().getSourceFile(unrelatedId));
				} finally {
					session.dispose();
				}
			}
		);
	});
});
