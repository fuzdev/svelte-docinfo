/**
 * Tests for the module file types beyond `.ts` and `.js` — `.mts`, `.tsx`,
 * `.mjs`, `.jsx` — and for JS under a tsconfig without `allowJs`, which the
 * analysis program always forces on.
 *
 * Extension mapping in exports discovery is covered in `exports.test.ts`, the
 * glob list in `files.test.ts`, and the CommonJS warning by the
 * `ts/module/commonjs/*` fixtures.
 */

import { join } from 'node:path';
import { test, assert, describe } from 'vitest';

import { analyze, analyzeFromFiles } from '#lib/analyze.ts';
import { createAnalysisSession } from '#lib/session.ts';
import { createSourceOptions } from '#lib/source-config.ts';
import type { AnalyzeResultJson } from '#lib/analyze-core.ts';
import type { SourceFileInfo } from '#lib/source.ts';

import { TEST_TSCONFIG_COMPILER_OPTIONS, findModule, withTestProject } from './test-helpers.ts';

const typeOf = (result: AnalyzeResultJson, name: string): string | undefined => {
	for (const module of result.modules) {
		const declaration = module.declarations.find((d) => d.name === name);
		if (declaration) return declaration.typeSignature;
	}
	return undefined;
};

/** Each module path with its dependency edges, sorted, as the output carries them. */
const edgesOf = (result: AnalyzeResultJson): Array<[string, Array<string>, Array<string>]> =>
	result.modules.map((m) => [m.path, m.dependencies, m.dependents]);

// the test tsconfig sets no `allowJs` (or `jsx`), like a TS-only project
const MIXED_FILES = {
	'src/lib/a.js': '/** @param {number} x */\nexport const fa = (x) => x + 1;',
	'src/lib/b.ts': "import {fa} from './a.js';\nexport const fb = fa;",
	'src/lib/c.mjs': "/** @returns {string} */\nexport function fc() { return 'c'; }",
	'src/lib/d.mts': "import {fc} from './c.mjs';\nexport const fd = fc;",
	'src/lib/e.jsx':
		'/** @param {{a: string}} props */\nexport const E = (props) => <p>{props.a}</p>;',
	'src/lib/f.tsx':
		"import {E} from './e.jsx';\nexport const F = <T,>(props: {b: T}) => <p>{props.b}</p>;\nexport const fe = E;"
};

describe('module file types', { timeout: 15_000 }, () => {
	test('glob discovery analyzes .mts, .tsx, .mjs, and .jsx modules and their edges', async () => {
		await withTestProject(MIXED_FILES, async (projectRoot) => {
			const result = await analyzeFromFiles({ projectRoot, discovery: 'glob' });
			assert.deepStrictEqual(result.diagnostics, []);
			assert.deepStrictEqual(edgesOf(result), [
				['a.js', [], ['b.ts']],
				['b.ts', ['a.js'], []],
				['c.mjs', [], ['d.mts']],
				['d.mts', ['c.mjs'], []],
				['e.jsx', [], ['f.tsx']],
				['f.tsx', ['e.jsx'], []]
			]);
			assert.strictEqual(typeOf(result, 'fb'), '(x: number) => number');
			assert.strictEqual(typeOf(result, 'fd'), '() => string');
			// no JSX namespace is in scope, so markup is `any`, as in TypeScript
			assert.strictEqual(typeOf(result, 'fe'), '(props: { a: string; }) => any');
			// a TSX generic arrow parses as one
			const f = findModule(result.modules, 'f.tsx').declarations.find((d) => d.name === 'F');
			assert.strictEqual(f?.typeSignature, '<T>(props: { b: T; }): any');
		});
	});

	test('exports discovery maps .js entries to .tsx/.jsx sources and .mjs ones to .mts/.mjs', async () => {
		await withTestProject(
			{
				...MIXED_FILES,
				'package.json': JSON.stringify({
					exports: {
						'./*.js': { types: './dist/*.d.ts', default: './dist/*.js' },
						'./*.mjs': { types: './dist/*.d.mts', default: './dist/*.mjs' }
					}
				})
			},
			async (projectRoot) => {
				const result = await analyzeFromFiles({ projectRoot, discovery: 'exports' });
				assert.deepStrictEqual(result.diagnostics, []);
				assert.deepStrictEqual(
					result.modules.map((m) => m.path),
					['a.js', 'b.ts', 'c.mjs', 'd.mts', 'e.jsx', 'f.tsx']
				);
			}
		);
	});
});

describe('allowJs', { timeout: 15_000 }, () => {
	test('a JS file documents under a tsconfig without allowJs, and types its TS importers', async () => {
		await withTestProject(MIXED_FILES, async (projectRoot) => {
			const result = await analyze({
				sourceFiles: ['src/lib/a.js', 'src/lib/b.ts'].map((path) => ({
					id: join(projectRoot, path),
					content: MIXED_FILES[path as keyof typeof MIXED_FILES]
				})),
				sourceOptions: createSourceOptions(projectRoot)
			});
			assert.deepStrictEqual(result.diagnostics, []);
			assert.strictEqual(typeOf(result, 'fa'), '(x: number): number');
			assert.strictEqual(typeOf(result, 'fb'), '(x: number) => number');
		});
	});

	test('a JS import nobody supplied types, with no JS file served', async () => {
		await withTestProject(MIXED_FILES, async (projectRoot) => {
			// `analyze` has no context closure: `a.js` reaches the program only
			// through the import, which needs `allowJs`
			const result = await analyze({
				sourceFiles: [
					{ id: join(projectRoot, 'src/lib/b.ts'), content: MIXED_FILES['src/lib/b.ts'] }
				],
				sourceOptions: createSourceOptions(projectRoot)
			});
			assert.strictEqual(typeOf(result, 'fb'), '(x: number) => number');
		});
	});

	test('a gated JS dependency the context closure ingests types its importer', async () => {
		await withTestProject(
			{
				'src/lib/internal/a.js': MIXED_FILES['src/lib/a.js'],
				'src/lib/b.ts': "import {fa} from './internal/a.js';\nexport const fb = fa;"
			},
			async (projectRoot) => {
				const result = await analyzeFromFiles({ projectRoot });
				assert.deepStrictEqual(result.diagnostics, []);
				assert.deepStrictEqual(edgesOf(result), [['b.ts', [], []]]);
				assert.strictEqual(typeOf(result, 'fb'), '(x: number) => number');
			}
		);
	});

	test("a package's self-name import resolves its edge as the program does", async () => {
		// self-name resolution through `exports` is the one resolution path that
		// reads `allowJs`: without it the `types` condition wins over `default`
		await withTestProject(
			{
				'package.json': JSON.stringify({
					name: 'p',
					type: 'module',
					exports: { './a': { default: './src/lib/a.js', types: './types/a.d.ts' } }
				}),
				'types/a.d.ts': 'export declare const fa: string;',
				'src/lib/a.js': MIXED_FILES['src/lib/a.js'],
				'src/lib/b.ts': "import {fa} from 'p/a';\nexport const fb = fa;"
			},
			async (projectRoot) => {
				const result = await analyzeFromFiles({ projectRoot, discovery: 'glob' });
				assert.deepStrictEqual(edgesOf(result), [
					['a.js', [], ['b.ts']],
					['b.ts', ['a.js'], []]
				]);
				assert.strictEqual(typeOf(result, 'fb'), '(x: number) => number');
			}
		);
	});
});

/**
 * Incremental output equals a fresh session's over the same owned files,
 * whichever JS files come and go (`allowJs` is forced on, never toggled).
 */
describe('allowJs session invariance', { timeout: 15_000 }, () => {
	const createSession = (projectRoot: string, contextClosure: boolean) =>
		createAnalysisSession({ sourceOptions: createSourceOptions(projectRoot), contextClosure });

	const assertMatchesFresh = async (
		session: ReturnType<typeof createSession>,
		projectRoot: string,
		contextClosure: boolean,
		files: Array<SourceFileInfo>
	): Promise<void> => {
		const fresh = createSession(projectRoot, contextClosure);
		try {
			await fresh.setFiles(files);
			assert.deepStrictEqual(session.query(), fresh.query());
		} finally {
			fresh.dispose();
		}
	};

	const fileOf =
		(projectRoot: string, files: Record<string, string>) =>
		(path: string): SourceFileInfo => ({ id: join(projectRoot, path), content: files[path]! });

	test('a JS file that is already a configured root documents when added mid-session', async () => {
		const files = {
			'src/lib/a.js': MIXED_FILES['src/lib/a.js'],
			'src/lib/b.ts': 'export const fb = 1;'
		};
		await withTestProject(
			{
				...files,
				'tsconfig.json': JSON.stringify({
					compilerOptions: TEST_TSCONFIG_COMPILER_OPTIONS,
					files: ['src/lib/a.js', 'src/lib/b.ts']
				})
			},
			async (projectRoot) => {
				const file = fileOf(projectRoot, files);
				const session = createSession(projectRoot, false);
				try {
					await session.setFiles([file('src/lib/b.ts')]);
					session.query();
					// adding a root changes no root list, so the program is reused
					await session.setFile(file('src/lib/a.js'));
					const result = session.query();
					assert.deepStrictEqual(result.diagnostics, []);
					assert.strictEqual(typeOf(result, 'fa'), '(x: number): number');
					await assertMatchesFresh(session, projectRoot, false, [
						file('src/lib/b.ts'),
						file('src/lib/a.js')
					]);
				} finally {
					session.dispose();
				}
			}
		);
	});

	test('a leftover context JS file leaves a .cjs import typed as a fresh session types it', async () => {
		const files = {
			'src/lib/internal/a.js': 'export const fa = 1;',
			'src/lib/b.ts': "import {fa} from './internal/a.js';\nexport const fb = fa;",
			'src/lib/d.ts': "import {fo} from './x.cjs';\nexport const fd = fo;",
			'src/lib/x.cjs': 'exports.fo = () => true;'
		};
		await withTestProject(files, async (projectRoot) => {
			const file = fileOf(projectRoot, files);
			const session = createSession(projectRoot, true);
			try {
				await session.setFiles([file('src/lib/b.ts'), file('src/lib/d.ts')]);
				assert.strictEqual(typeOf(session.query(), 'fd'), '() => boolean');
				// the closure-ingested `internal/a.js` stays owned after this
				await session.deleteFile(join(projectRoot, 'src/lib/b.ts'));
				assert.ok(session.has(join(projectRoot, 'src/lib/internal/a.js')));
				assert.strictEqual(typeOf(session.query(), 'fd'), '() => boolean');
				await assertMatchesFresh(session, projectRoot, true, [file('src/lib/d.ts')]);
			} finally {
				session.dispose();
			}
		});
	});

	for (const contextClosure of [false, true]) {
		test(`JS files coming and going match a fresh session (contextClosure: ${contextClosure})`, async () => {
			const files = {
				...MIXED_FILES,
				'src/lib/g.js': 'export const fg = 1;',
				'src/lib/h.ts': 'export const fh = (x: string) => x;',
				'outside/o.js': '/** @returns {boolean} */ export const fo = () => true;',
				'src/lib/i.ts': "import {fo} from '../../outside/o.js';\nexport const fi = fo;"
			};
			await withTestProject(files, async (projectRoot) => {
				const file = fileOf(projectRoot, files);
				const session = createSession(projectRoot, contextClosure);
				try {
					await session.setFiles([
						file('src/lib/a.js'),
						file('src/lib/b.ts'),
						file('src/lib/i.ts')
					]);
					session.query();
					// re-ingest changed and unchanged content, then delete twice
					await session.setFile({ ...file('src/lib/a.js'), content: files['src/lib/a.js'] + '\n' });
					await session.setFile(file('src/lib/a.js'));
					await session.deleteFile(join(projectRoot, 'src/lib/a.js'));
					await session.deleteFile(join(projectRoot, 'src/lib/a.js'));
					await assertMatchesFresh(session, projectRoot, contextClosure, [
						file('src/lib/b.ts'),
						file('src/lib/i.ts')
					]);
					// an out-of-root JS import types the same with or without an owned JS file
					assert.strictEqual(typeOf(session.query(), 'fi'), '() => boolean');
					await session.setFile(file('src/lib/g.js'));
					assert.strictEqual(typeOf(session.query(), 'fi'), '() => boolean');
					await assertMatchesFresh(session, projectRoot, contextClosure, [
						file('src/lib/b.ts'),
						file('src/lib/i.ts'),
						file('src/lib/g.js')
					]);
					await session.deleteFile(join(projectRoot, 'src/lib/g.js'));
					await session.setFile(file('src/lib/h.ts'));
					await assertMatchesFresh(session, projectRoot, contextClosure, [
						file('src/lib/b.ts'),
						file('src/lib/i.ts'),
						file('src/lib/h.ts')
					]);
				} finally {
					session.dispose();
				}
			});
		});
	}
});

describe('CommonJS', { timeout: 15_000 }, () => {
	/** Each diagnostic as `[kind, file, line, column]`, plus each module's declaration count. */
	const commonjsOutcome = async (files: Record<string, string>) =>
		withTestProject(files, async (projectRoot) => {
			const result = await analyzeFromFiles({ projectRoot, discovery: 'glob' });
			return {
				diagnostics: result.diagnostics.map((d) => [d.kind, d.file, d.line, d.column]),
				modules: result.modules.map((m) => [m.path, m.declarations.length])
			};
		});

	test('warns at the first export assignment, `exports.x` or `module.exports`', async () => {
		assert.deepStrictEqual(
			await commonjsOutcome({
				'src/lib/a.js': '/** Docs. */\nexports.b = 1;\nmodule.exports.c = 2;',
				'src/lib/b.js': "require('./a.js');\nexports['d'] = 1;",
				'src/lib/c.js': 'module.exports = 3;'
			}),
			{
				diagnostics: [
					['commonjs_unsupported', 'src/lib/a.js', 2, 1],
					['commonjs_unsupported', 'src/lib/b.js', 2, 1],
					['commonjs_unsupported', 'src/lib/c.js', 1, 1]
				],
				modules: [
					['a.js', 0],
					['b.js', 0],
					['c.js', 0]
				]
			}
		);
	});

	test('a script binding its own top-level `exports` or `module` does not warn', async () => {
		assert.deepStrictEqual(
			await commonjsOutcome({
				'src/lib/a.js': 'const exports = {};\nexports.a = 1;\nconsole.log(exports);',
				'src/lib/b.js': 'var module = {exports: {}};\nmodule.exports = 3;',
				'src/lib/c.js': 'let {exports} = globalThis.x;\nexports.c = 1;',
				'src/lib/d.js': 'var [, module] = globalThis.y;\nmodule.exports.d = 1;',
				'src/lib/e.js': 'function exports() {}\nexports.e = 1;',
				'src/lib/f.js': 'class module {}\nmodule.exports = 1;'
			}),
			{
				diagnostics: [],
				modules: [
					['a.js', 0],
					['b.js', 0],
					['c.js', 0],
					['d.js', 0],
					['e.js', 0],
					['f.js', 0]
				]
			}
		);
	});

	test('a binding of another name, or a nested one, still warns', async () => {
		assert.deepStrictEqual(
			(
				await commonjsOutcome({
					'src/lib/a.js': 'const module2 = {};\nmodule.exports = 1;',
					'src/lib/b.js': 'function f() { const exports = {}; }\nexports.b = 1;'
				})
			).diagnostics,
			[
				['commonjs_unsupported', 'src/lib/a.js', 2, 1],
				['commonjs_unsupported', 'src/lib/b.js', 2, 1]
			]
		);
	});

	test('warns for a JS file only, not for a TypeScript one', async () => {
		const files = {
			'src/lib/a.js': 'module.exports = {a: 1};',
			'src/lib/b.ts': 'declare const module: {exports: unknown};\nmodule.exports = {b: 1};'
		};
		await withTestProject(files, async (projectRoot) => {
			const result = await analyzeFromFiles({ projectRoot });
			assert.deepStrictEqual(
				result.diagnostics.map((d) => [d.kind, d.file, d.line]),
				[['commonjs_unsupported', 'src/lib/a.js', 1]]
			);
			assert.deepStrictEqual(
				result.modules.map((m) => [m.path, m.declarations.length]),
				[
					['a.js', 0],
					['b.ts', 0]
				]
			);
		});
	});
});
