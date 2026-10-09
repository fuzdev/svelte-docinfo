/**
 * Tests that analysis output is a function of the file set, not the order the
 * files arrive in.
 *
 * TypeScript prints a union with no alias origin (`z.enum` members, a literal
 * union read off a `const` tuple) in type-creation order, so whichever module
 * the checker visits first decides its member order. The fixture's `kinds.ts`
 * creates `'c' | 'b' | 'a'` in that order, while `pick.ts` creates `'a'` on
 * its own - analyzed first, it flips the printed union to start with `"a"`.
 * `query()` sorts the owned set before analysis, so every ingest order (one
 * batch forward or reversed, `setFile` one at a time, or disk discovery)
 * produces the same output.
 *
 * Program root order matters too: it sets the program's file order, and with
 * it the merge order of `declare global` interface declarations. Files the
 * tsconfig doesn't list become owned roots, which the language-service host
 * returns sorted rather than in ingest order.
 */

import { test, assert, describe } from 'vitest';
import { join } from 'node:path';

import { analyze, analyzeFromFiles } from '$lib/analyze.ts';
import { createAnalysisSession, type AnalysisSession } from '$lib/session.ts';
import { createSourceOptions } from '$lib/source-config.ts';
import type { SourceFileInfo } from '$lib/source.ts';
import type { AnalyzeResultJson } from '$lib/analyze-core.ts';

import { assertHasDeclaration, findModule, withTestProject } from './test-helpers.ts';

// `pick.ts` sorts after `kinds.ts`, so forward order analyzes the tuple first
// and reversed order creates the lone `'a'` first
const FILES: Record<string, string> = {
	'src/lib/kinds.ts': `
export const KINDS = ['c', 'b', 'a'] as const;
export const isKind = (v: string): v is (typeof KINDS)[number] => (KINDS as ReadonlyArray<string>).includes(v);
export const firstKind = (): (typeof KINDS)[number] => KINDS[0];
`,
	'src/lib/pick.ts': `
export const PICK = 'a' as const;
export const pick = (): typeof PICK => PICK;
`
};

const toSourceFiles = (projectRoot: string): Array<SourceFileInfo> =>
	Object.entries(FILES).map(([path, content]) => ({ id: join(projectRoot, path), content }));

const assertSameOutput = (actual: AnalyzeResultJson, expected: AnalyzeResultJson): void => {
	assert.deepStrictEqual(actual.modules, expected.modules);
	assert.deepStrictEqual(actual.diagnostics, expected.diagnostics);
};

/** The printed union, asserted to carry every member so a match isn't vacuous. */
const firstKindReturn = (result: AnalyzeResultJson): string => {
	const declaration = assertHasDeclaration(findModule(result.modules, 'kinds.ts'), 'firstKind');
	if (declaration.kind !== 'function') throw new Error('expected function');
	const returnType = declaration.returnType;
	assert(returnType !== undefined);
	for (const member of ['"a"', '"b"', '"c"']) assert.include(returnType, member);
	return returnType;
};

const querySession = async (
	projectRoot: string,
	ingest: (session: AnalysisSession) => Promise<void>
): Promise<AnalyzeResultJson> => {
	const session = createAnalysisSession({ sourceOptions: createSourceOptions(projectRoot) });
	try {
		await ingest(session);
		return session.query();
	} finally {
		session.dispose();
	}
};

// the tsconfig covers no file, so every ingested file is an owned program
// root, and root order decides the member order of the merged interface
const GLOBAL_MERGE_FILES: Record<string, string> = {
	'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true }, include: ['none/**/*'] }),
	'src/lib/a.ts': 'declare global { interface Merged { zeta: 1; } }\nexport const a = 1;',
	'src/lib/b.ts': 'declare global { interface Merged { alpha: 2; } }\nexport const b = 2;',
	'src/lib/use.ts': 'export type Copy = {[K in keyof Merged]: Merged[K]};'
};

describe('input order', { timeout: 30_000 }, () => {
	test('a session batch gives the same output forward and reversed', async () => {
		await withTestProject(FILES, async (projectRoot) => {
			const files = toSourceFiles(projectRoot);
			const forward = await querySession(projectRoot, async (s) => {
				await s.setFiles(files);
			});
			const reversed = await querySession(projectRoot, async (s) => {
				await s.setFiles(files.slice().reverse());
			});
			assert.strictEqual(firstKindReturn(reversed), firstKindReturn(forward));
			assertSameOutput(reversed, forward);
		});
	});

	test('incremental setFile in any order equals one batch', async () => {
		await withTestProject(FILES, async (projectRoot) => {
			const files = toSourceFiles(projectRoot);
			const batch = await querySession(projectRoot, async (s) => {
				await s.setFiles(files);
			});
			for (const order of [files, files.slice().reverse()]) {
				const incremental = await querySession(projectRoot, async (s) => {
					for (const file of order) await s.setFile(file);
				});
				assert.strictEqual(firstKindReturn(incremental), firstKindReturn(batch));
				assertSameOutput(incremental, batch);
			}
		});
	});

	test('analyze and analyzeFromFiles agree across orders', async () => {
		await withTestProject(FILES, async (projectRoot) => {
			const files = toSourceFiles(projectRoot);
			const sourceOptions = createSourceOptions(projectRoot);
			const forward = await analyze({ sourceFiles: files, sourceOptions });
			const reversed = await analyze({ sourceFiles: files.slice().reverse(), sourceOptions });
			const discovered = await analyzeFromFiles({ projectRoot });
			assert.strictEqual(firstKindReturn(reversed), firstKindReturn(forward));
			assertSameOutput(reversed, forward);
			assertSameOutput(discovered, forward);
		});
	});

	test('program root order does not follow ingest order', async () => {
		await withTestProject(GLOBAL_MERGE_FILES, async (projectRoot) => {
			const files = ['src/lib/a.ts', 'src/lib/b.ts', 'src/lib/use.ts'].map((path) => ({
				id: join(projectRoot, path),
				content: GLOBAL_MERGE_FILES[path]!
			}));
			const forward = await querySession(projectRoot, async (s) => {
				await s.setFiles(files);
			});
			const reversed = await querySession(projectRoot, async (s) => {
				await s.setFiles(files.slice().reverse());
			});
			const copy = assertHasDeclaration(findModule(forward.modules, 'use.ts'), 'Copy');
			if (copy.kind !== 'type') throw new Error('expected type');
			assert.sameMembers(
				(copy.members ?? []).map((m) => m.name),
				['zeta', 'alpha']
			);
			assertSameOutput(reversed, forward);
		});
	});
});
