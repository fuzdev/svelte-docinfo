import ts from 'typescript';
import { posix } from 'node:path';

import { analyzeCore, type AnalyzeResultJson } from '$lib/analyze-core.ts';
import { ensureLexerReady, lexImports } from '$lib/dep-resolver.ts';
import { isSource } from '$lib/source-config.ts';
import { computeDependents } from '$lib/postprocess.ts';
import type { SourceFileInfo } from '$lib/source.ts';

import { loadFixturesGeneric, type FixtureExtraFile } from '../../test-helpers.ts';
import { createTestSourceOptions, TEST_PROJECT_ROOT } from '../../test-module-helpers.ts';
import {
	captureModuleFixture,
	fixtureFileId,
	type ModuleFixture,
	type ModuleFixtureJson,
	type ModuleFixtureJsonInput
} from '../module-fixture-helpers.ts';

/**
 * Synthetic file id for fixture analysis — `path` extracts to `input.ts` and
 * diagnostic paths normalize to `src/lib/input.ts` deterministically on every
 * machine. See `fixtureFileId` for the `src/lib` invariant.
 */
const FIXTURE_FILE_ID = fixtureFileId(TEST_PROJECT_ROOT, 'input.ts');

/**
 * Create a single-file TypeScript program — `noResolve`, so fixtures stay
 * hermetic and fast. Mirrors `createAnalysisProgram` by returning
 * `ts.Program` directly.
 *
 * @param sourceFile - The TypeScript source file to analyze
 * @param filePath - The path identifier for the file
 */
export const createTestProgram = (sourceFile: ts.SourceFile, filePath: string): ts.Program =>
	ts.createProgram(
		[filePath],
		{
			target: ts.ScriptTarget.Latest,
			module: ts.ModuleKind.ESNext,
			// consumers analyze under `strict`; without it nullable unions collapse
			// before extraction sees them and fixtures stop reflecting real output
			strict: true,
			noResolve: true
		},
		{
			getSourceFile: (fileName) => {
				if (fileName === filePath) return sourceFile;
				return undefined;
			},
			writeFile: () => undefined,
			getCurrentDirectory: () => '',
			getDirectories: () => [],
			fileExists: () => true,
			readFile: () => '',
			getCanonicalFileName: (fileName) => fileName,
			useCaseSensitiveFileNames: () => true,
			getNewLine: () => '\n',
			getDefaultLibFileName: () => 'lib.d.ts'
		}
	);

/**
 * Analyze a fixture input through the production pipeline (see
 * `captureModuleFixture`). Used by both `typescript.test.ts` and the update
 * task so the two can't diverge.
 */
export const analyzeFixtureModule = (input: string): ModuleFixtureJson => {
	const sourceFile = ts.createSourceFile(
		FIXTURE_FILE_ID,
		input,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS
	);
	const program = createTestProgram(sourceFile, FIXTURE_FILE_ID);
	return captureModuleFixture(
		{ id: FIXTURE_FILE_ID, content: input },
		program,
		createTestSourceOptions()
	);
};

// Multi-file fixtures

/**
 * Reserved fixture subdirectory whose files map into the synthetic project's
 * `node_modules/` — externality by path, through the production
 * `createIsExternalPath` rule, with no test-only predicate. Named `external/`
 * rather than a literal `node_modules/` so `.gitignore`'s any-depth
 * `node_modules` match can't silently untrack fixture files.
 */
const EXTERNAL_DIR_PREFIX = 'external/';

/**
 * The synthetic project's `node_modules` root — the one string the file
 * mapping and the bare-specifier resolution share, so they can't drift apart
 * (a mismatch wouldn't throw; imports would just silently stop resolving).
 */
const NODE_MODULES_ROOT = `${TEST_PROJECT_ROOT}/node_modules`;

/**
 * Map a fixture-dir-relative path to its synthetic project file id: locals
 * land in `src/lib/` (so `internal/helper.ts` hits the default
 * `**\/internal\/**` exclude and exercises the gated-canonical machinery),
 * `external/**` lands verbatim in `node_modules/` (so `external/extpkg/index.d.ts`
 * is importable as `extpkg` and classifies external).
 */
const fixtureProjectFileId = (relPath: string): string =>
	relPath.startsWith(EXTERNAL_DIR_PREFIX)
		? `${NODE_MODULES_ROOT}/${relPath.slice(EXTERNAL_DIR_PREFIX.length)}`
		: fixtureFileId(TEST_PROJECT_ROOT, relPath);

/**
 * Resolve an import specifier against the fixture project's file set.
 *
 * Relative specifiers resolve from the importing file's directory (exact,
 * `.js` → `.ts` swap, appended `.ts`/`.d.ts`, `index` fallbacks); bare
 * specifiers resolve into the mapped `node_modules/` the same way
 * (`extpkg` → `node_modules/extpkg/index.ts`, `pkg/sub` → `node_modules/pkg/sub.ts`).
 * Returns `undefined` for anything the set doesn't contain — mirroring an
 * unresolvable import, which analysis tolerates.
 */
const resolveFixtureSpecifier = (
	specifier: string,
	containingFile: string,
	fileIds: ReadonlySet<string>
): string | undefined => {
	const base =
		specifier.startsWith('./') || specifier.startsWith('../')
			? posix.join(posix.dirname(containingFile), specifier)
			: `${NODE_MODULES_ROOT}/${specifier}`;
	const candidates = [
		base,
		base.replace(/\.js$/, '.ts'),
		`${base}.ts`,
		`${base}.d.ts`,
		`${base}/index.ts`,
		`${base}/index.d.ts`
	];
	return candidates.find((c) => fileIds.has(c));
};

/**
 * Create an in-memory multi-file program over mapped fixture files. Same
 * lib-less host shape as `createTestProgram` (fixtures never rely on lib
 * types), with resolution enabled through `resolveFixtureSpecifier` so
 * re-exports and cross-file references bind — but never escaping the mapped
 * set, keeping fixtures hermetic.
 */
const createFixtureProjectProgram = (
	sourceFiles: ReadonlyMap<string, ts.SourceFile>
): ts.Program => {
	const fileIds = new Set(sourceFiles.keys());
	return ts.createProgram(
		[...sourceFiles.keys()],
		{
			target: ts.ScriptTarget.Latest,
			module: ts.ModuleKind.ESNext,
			// consumers analyze under `strict`; see `createTestProgram`
			strict: true
		},
		{
			getSourceFile: (fileName) => sourceFiles.get(fileName),
			writeFile: () => undefined,
			getCurrentDirectory: () => TEST_PROJECT_ROOT,
			getDirectories: () => [],
			fileExists: (fileName) => sourceFiles.has(fileName),
			readFile: (fileName) => sourceFiles.get(fileName)?.text ?? '',
			getCanonicalFileName: (fileName) => fileName,
			useCaseSensitiveFileNames: () => true,
			getNewLine: () => '\n',
			getDefaultLibFileName: () => 'lib.d.ts',
			resolveModuleNames: (moduleNames, containingFile) =>
				moduleNames.map((name) => {
					const resolved = resolveFixtureSpecifier(name, containingFile, fileIds);
					return resolved
						? { resolvedFileName: resolved, isExternalLibraryImport: false }
						: undefined;
				})
		}
	);
};

/**
 * Analyze a multi-file fixture through the production pipeline and capture
 * the whole `AnalyzeResultJson` envelope — a multi-file fixture exists for
 * cross-module facts (`alsoExportedFrom` lands on the canonical,
 * `dependents` on the dep), so every emitted module is locked, not just
 * `input.ts`'s.
 *
 * Mirrors `session.query`'s input assembly: only `isSource`-passing locals
 * become `sourceFiles` (a gated `internal/` sibling reaches the checker via
 * the program alone), each with pre-resolved `dependencies` — lexed with the
 * production `lexImports`, resolved against the mapped set, filtered to the
 * emitted set — and `computeDependents` derives the reverse edges. The
 * harness is thereby the pre-resolved-deps caller the session documents
 * (type-only edges kept, like default lex+resolve).
 */
export const analyzeFixtureProject = async (
	input: string,
	extraFiles: ReadonlyArray<FixtureExtraFile>
): Promise<AnalyzeResultJson> => {
	await ensureLexerReady();
	const sourceOptions = createTestSourceOptions();

	// classify at mapping time — `external` comes from the `external/` prefix,
	// the same fact the id mapping consumed, not re-derived from the mapped path
	const entries = [{ path: 'input.ts', content: input }, ...extraFiles].map((f) => ({
		id: fixtureProjectFileId(f.path),
		content: f.content,
		external: f.path.startsWith(EXTERNAL_DIR_PREFIX)
	}));
	const fileIds = new Set(entries.map((e) => e.id));

	const sourceFileAsts = new Map(
		entries.map((e) => [
			e.id,
			ts.createSourceFile(e.id, e.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
		])
	);
	const program = createFixtureProjectProgram(sourceFileAsts);

	const emittedIds = new Set(
		entries.filter((e) => !e.external && isSource(e.id, sourceOptions)).map((e) => e.id)
	);

	const sourceFiles: Array<SourceFileInfo> = entries
		.filter((e) => emittedIds.has(e.id))
		.map(({ id, content }) => {
			const resolved = lexImports(content, id)
				.map((specifier) => resolveFixtureSpecifier(specifier, id, fileIds))
				.filter((dep): dep is string => dep !== undefined && emittedIds.has(dep));
			return { id, content, dependencies: [...new Set(resolved)] };
		});

	return analyzeCore({
		sourceFiles: computeDependents(sourceFiles),
		sourceOptions,
		program,
		svelteVirtualFiles: new Map()
	});
};

/**
 * The one analysis entry for ts fixtures, used identically by
 * `typescript.test.ts` and the update task so the two can't diverge: a
 * fixture with sibling files captures the `AnalyzeResultJson` envelope, a
 * single-file fixture captures `ModuleFixtureJson` (see
 * `module-fixture-helpers.ts` for why the shapes differ).
 */
export const analyzeTsFixture = async (
	input: string,
	extraFiles?: ReadonlyArray<FixtureExtraFile>
): Promise<ModuleFixtureJson | AnalyzeResultJson> =>
	extraFiles?.length ? analyzeFixtureProject(input, extraFiles) : analyzeFixtureModule(input);

/**
 * A source file entry for multi-file test programs.
 */
export interface TestSourceFile {
	path: string;
	content: string;
}

/**
 * Create a TypeScript program with multiple source files.
 * Used for testing re-export scenarios where declarations are in different files.
 *
 * Note: The re-export detection in tsHelpers.ts uses `checker.getAliasedSymbol()` to
 * properly resolve aliases to their original declarations, which works correctly with
 * this test infrastructure.
 *
 * @param files - Array of source files with their paths and content
 * @returns Object with program and a map of source files by path
 */
export const createMultiFileProgram = (
	files: Array<TestSourceFile>
): { program: ts.Program; sourceFiles: Map<string, ts.SourceFile> } => {
	// Create source files
	const sourceFiles = new Map<string, ts.SourceFile>();
	for (const file of files) {
		const sourceFile = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
		sourceFiles.set(file.path, sourceFile);
	}

	const filePaths = files.map((f) => f.path);

	const program = ts.createProgram(
		filePaths,
		{
			target: ts.ScriptTarget.Latest,
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.NodeNext,
			strict: true
		},
		{
			getSourceFile: (fileName) => sourceFiles.get(fileName),
			writeFile: () => undefined,
			getCurrentDirectory: () => '/src/lib',
			getDirectories: () => [],
			fileExists: (fileName) => sourceFiles.has(fileName),
			readFile: (fileName) => {
				const sf = sourceFiles.get(fileName);
				return sf?.text ?? '';
			},
			getCanonicalFileName: (fileName) => fileName,
			useCaseSensitiveFileNames: () => true,
			getNewLine: () => '\n',
			getDefaultLibFileName: () => 'lib.d.ts',
			resolveModuleNames: (moduleNames, _containingFile) => {
				return moduleNames.map((name) => {
					// Handle relative imports like './foo.js' or './foo.ts'
					if (name.startsWith('./')) {
						const resolved = name.replace(/^\.\//, '/src/lib/').replace(/\.js$/, '.ts');
						if (sourceFiles.has(resolved)) {
							return { resolvedFileName: resolved, isExternalLibraryImport: false };
						}
					}
					return undefined;
				});
			}
		}
	);

	return { program, sourceFiles };
};

/**
 * Find a top-level declaration of any kind in a source file by name.
 *
 * Walks the source file's statements and returns the first matching node. Used
 * by tests that need to grab a specific declaration to feed into extractors.
 */
export const findDeclarationNode = (
	sourceFile: ts.SourceFile,
	name: string
): ts.Node | undefined => {
	for (const stmt of sourceFile.statements) {
		if (
			(ts.isTypeAliasDeclaration(stmt) ||
				ts.isInterfaceDeclaration(stmt) ||
				ts.isClassDeclaration(stmt) ||
				ts.isEnumDeclaration(stmt) ||
				ts.isFunctionDeclaration(stmt)) &&
			stmt.name?.text === name
		) {
			return stmt;
		}
		if (ts.isVariableStatement(stmt)) {
			for (const decl of stmt.declarationList.declarations) {
				if (ts.isIdentifier(decl.name) && decl.name.text === name) return decl;
			}
		}
	}
	return undefined;
};

/**
 * Find a type alias by name and return its node and resolved type. Returns
 * `undefined` when the name doesn't resolve to a type alias.
 */
export const findTypeAlias = (
	sourceFile: ts.SourceFile,
	checker: ts.TypeChecker,
	name: string
): { node: ts.TypeAliasDeclaration; type: ts.Type } | undefined => {
	const node = findDeclarationNode(sourceFile, name);
	if (!node || !ts.isTypeAliasDeclaration(node)) return undefined;
	return { node, type: checker.getTypeAtLocation(node) };
};

/**
 * Load all fixtures from the ts fixtures directory. Multi-file fixtures carry
 * `extraFiles` and their `expected` is the `AnalyzeResultJson` envelope
 * rather than `ModuleFixtureJsonInput` — callers branch on `extraFiles`.
 */
export const loadFixtures = async (): Promise<Array<ModuleFixture>> =>
	loadFixturesGeneric<ModuleFixtureJsonInput>({
		fixturesDir: import.meta.dirname,
		inputExtension: '.ts',
		loadExtraFiles: true
	});
