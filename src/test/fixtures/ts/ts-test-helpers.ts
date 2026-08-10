import ts from 'typescript';

import { loadFixturesGeneric } from '../../test-helpers.ts';
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
 * Load all fixtures from the ts fixtures directory.
 */
export const loadFixtures = async (): Promise<Array<ModuleFixture>> =>
	loadFixturesGeneric<ModuleFixtureJsonInput>({
		fixturesDir: import.meta.dirname,
		inputExtension: '.ts'
	});
