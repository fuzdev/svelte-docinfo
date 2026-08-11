/**
 * Loading and analysis helpers for the ts fixture set, plus the in-memory
 * `ts.Program` constructors the unit tests share.
 *
 * Every program here is built by `createProgramOverSources` — one host, one
 * resolver (`resolveFixtureSpecifier`), one set of compiler options — so a
 * single-file fixture, a multi-file fixture project, and a unit test's
 * hand-written file set can't drift apart in how they see the compiler. The
 * real-compiler-host counterpart (lib and `node_modules` resolve) is
 * `createVirtualFileProgram` in `test-module-helpers.ts`.
 *
 * @module
 */

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
 * Resolve an import specifier against a test program's file set.
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

// Program construction

/**
 * Compiler options shared by every program built here.
 *
 * `strict` is load-bearing rather than incidental: consumers analyze under it,
 * and without it nullable unions collapse before extraction sees them and
 * fixtures stop reflecting real output.
 */
const TEST_COMPILER_OPTIONS: ts.CompilerOptions = {
	target: ts.ScriptTarget.Latest,
	module: ts.ModuleKind.ESNext,
	strict: true
};

/**
 * The `ts.CompilerHost` fields every program built here shares — everything
 * the file set doesn't decide. `getDefaultLibFileName` names a file no set
 * ever contains, so these programs are lib-less by construction: tests here
 * assert on the checker's rendering of their own types, and loading a real
 * `lib.d.ts` would only cost time.
 */
const TEST_HOST_BASE = {
	writeFile: () => undefined,
	getDirectories: () => [],
	getCanonicalFileName: (fileName: string) => fileName,
	useCaseSensitiveFileNames: () => true,
	getNewLine: () => '\n',
	getDefaultLibFileName: () => 'lib.d.ts'
} satisfies Partial<ts.CompilerHost>;

/**
 * The one in-memory program constructor behind every test program here: a host
 * serving exactly `sourceFiles` and resolving imports with
 * `resolveFixtureSpecifier`, so nothing outside the given set can enter and
 * programs stay hermetic and fast. Mirrors `createAnalysisProgram` by
 * returning `ts.Program` directly.
 *
 * @param sourceFiles - Parsed sources keyed by the id the program sees
 * @param options - `currentDirectory` is the host's, consulted only when a
 *   root name is relative (`ts.createProgram` normalizes root names against
 *   it); `noResolve` skips module resolution outright, for single-file
 *   programs that have nothing to resolve against
 */
const createProgramOverSources = (
	sourceFiles: ReadonlyMap<string, ts.SourceFile>,
	options: { currentDirectory: string; noResolve?: boolean }
): ts.Program => {
	const fileIds = new Set(sourceFiles.keys());
	return ts.createProgram(
		[...fileIds],
		{ ...TEST_COMPILER_OPTIONS, noResolve: options.noResolve },
		{
			...TEST_HOST_BASE,
			getSourceFile: (fileName) => sourceFiles.get(fileName),
			getCurrentDirectory: () => options.currentDirectory,
			fileExists: (fileName) => fileIds.has(fileName),
			readFile: (fileName) => sourceFiles.get(fileName)?.text ?? '',
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
 * Create a single-file TypeScript program — `noResolve`, so fixtures stay
 * hermetic and fast. Reached through `createSourceAndChecker` (unit tests) or
 * `analyzeFixtureModule` (the fixture harness), which own the parse beside it.
 *
 * @param sourceFile - The TypeScript source file to analyze
 * @param filePath - The path identifier for the file
 */
const createSingleFileProgram = (sourceFile: ts.SourceFile, filePath: string): ts.Program =>
	createProgramOverSources(new Map([[filePath, sourceFile]]), {
		// callers pass bare names (`'test.ts'`) as readily as absolute ids, and
		// root names normalize against the current directory — a non-empty one
		// would re-key them past the map and yield an empty program
		currentDirectory: '',
		noResolve: true
	});

/**
 * Parse `content` and build a single-file program over it, returning the
 * source file beside the checker that sees it — the pair most extractor unit
 * tests want.
 *
 * The path is written once here on purpose: handing different names to
 * `ts.createSourceFile` and to the program yields a program with no files at
 * all, and nothing about the resulting checker says so.
 *
 * @param content - Source text to parse
 * @param filePath - Path identifier for the file; cosmetic under `noResolve`,
 *   so tests with nothing riding on it take the default
 */
export const createSourceAndChecker = (
	content: string,
	filePath = 'test.ts'
): { sourceFile: ts.SourceFile; checker: ts.TypeChecker } => {
	const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
	return { sourceFile, checker: createSingleFileProgram(sourceFile, filePath).getTypeChecker() };
};

/**
 * A source file entry for multi-file test programs.
 */
export interface TestSourceFile {
	path: string;
	content: string;
}

/**
 * Create a TypeScript program with multiple source files, for testing
 * cross-module scenarios (re-exports, imported types) where declarations live
 * in different files.
 *
 * `path` is the absolute id the program sees, so callers choose their own
 * layout — relative specifiers resolve against the importing file, not against
 * any root. Two things do key off the synthetic project root: ids under
 * `TEST_LIB_DIR` line up with `createTestSourceOptions()`, so module paths
 * extract as the tests assert them, and a file placed under
 * `${TEST_PROJECT_ROOT}/node_modules/` is reachable by bare specifier through
 * `resolveFixtureSpecifier`'s package arm (the id mapping that spells that
 * directory `external/` belongs to `analyzeFixtureProject`, not here).
 *
 * @param files - Array of source files with their paths and content
 * @returns Object with program and a map of source files by path
 */
export const createMultiFileProgram = (
	files: Array<TestSourceFile>
): { program: ts.Program; sourceFiles: Map<string, ts.SourceFile> } => {
	const sourceFiles = new Map<string, ts.SourceFile>(
		files.map((file) => [
			file.path,
			ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true)
		])
	);
	return {
		program: createProgramOverSources(sourceFiles, { currentDirectory: TEST_PROJECT_ROOT }),
		sourceFiles
	};
};

// Fixture analysis

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
	const program = createSingleFileProgram(sourceFile, FIXTURE_FILE_ID);
	return captureModuleFixture(
		{ id: FIXTURE_FILE_ID, content: input },
		program,
		createTestSourceOptions()
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
	const program = createProgramOverSources(sourceFileAsts, {
		currentDirectory: TEST_PROJECT_ROOT
	});

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

// Node lookup

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
