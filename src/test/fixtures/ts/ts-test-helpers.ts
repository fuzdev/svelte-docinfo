import ts from 'typescript';

import { DeclarationJson, type DeclarationJsonInput } from '$lib/types.ts';
import { analyzeDeclaration, extractModuleComment } from '$lib/typescript-exports.ts';
import type { Diagnostic } from '$lib/diagnostics.ts';

import { loadFixturesGeneric } from '../../test-helpers.ts';

export type TsFixtureCategory = 'declaration' | 'moduleComment';

export interface TsFixture {
	name: string;
	category: TsFixtureCategory;
	input: string;
	/**
	 * string for moduleComment category, null for module_no_comment case,
	 * otherwise a `DeclarationJsonInput` (wire form — fixtures are written
	 * through `compactReplacer` so defaulted array/boolean fields are
	 * stripped on disk).
	 */
	expected: DeclarationJsonInput | string | null;
}

/**
 * Create a TypeScript program for a given source file.
 * Used by both test files and update tasks to ensure consistent behavior.
 * Mirrors `createAnalysisProgram` by returning `ts.Program` directly.
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
 * Create a TypeScript program from a fixture.
 * Convenience wrapper for the common pattern of creating a source file then a program.
 *
 * @param fixture - The TypeScript fixture
 * @returns An object with the program, checker, and source file
 */
export const createFixtureProgram = (
	fixture: TsFixture
): { program: ts.Program; checker: ts.TypeChecker; sourceFile: ts.SourceFile } => {
	const sourceFile = ts.createSourceFile(
		`${fixture.name}.ts`,
		fixture.input,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS
	);
	const program = createTestProgram(sourceFile, `${fixture.name}.ts`);
	return { program, checker: program.getTypeChecker(), sourceFile };
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
 * Extract a declaration from a TypeScript source file for fixture comparison.
 * Used by both test files and update tasks to ensure consistent behavior.
 *
 * Routes through the production `analyzeDeclaration` — the statement walk here
 * only locates the first exported symbol; node selection, kind dispatch, and
 * TSDoc handling (merged value+type selection and doc fallback included) are
 * production code, so the fixtures can't drift from real output. Diagnostics
 * are discarded (the fixture harness doesn't model them).
 *
 * @param sourceFile - The TypeScript source file to analyze
 * @param checker - The TypeScript type checker
 * @param category - The fixture category (declaration or moduleComment)
 * @returns The extracted declaration (null for `@nodocs`), or the module
 * comment string (null when absent) for the moduleComment category
 */
export const extractDeclarationFromSource = (
	sourceFile: ts.SourceFile,
	checker: ts.TypeChecker,
	category: TsFixtureCategory
): DeclarationJson | string | null => {
	// Handle moduleComment category differently (returns string, not DeclarationJson)
	if (category === 'moduleComment') {
		return extractModuleComment(sourceFile) ?? null;
	}

	// Find the first exported declaration's symbol
	for (const statement of sourceFile.statements) {
		const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
		const isExported = modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword);
		if (!isExported) continue;

		let nameNode: ts.Identifier | undefined;
		if (
			(ts.isFunctionDeclaration(statement) ||
				ts.isClassDeclaration(statement) ||
				ts.isInterfaceDeclaration(statement) ||
				ts.isTypeAliasDeclaration(statement) ||
				ts.isEnumDeclaration(statement)) &&
			statement.name
		) {
			nameNode = statement.name;
		} else if (ts.isVariableStatement(statement)) {
			// Get the first declaration
			const decl = statement.declarationList.declarations[0];
			if (decl && ts.isIdentifier(decl.name)) {
				nameNode = decl.name;
			}
		}
		if (!nameNode) continue;

		const symbol = checker.getSymbolAtLocation(nameNode);
		if (!symbol) continue;

		const diagnostics: Array<Diagnostic> = [];
		const { declaration, nodocs } = analyzeDeclaration(
			symbol,
			sourceFile,
			checker,
			diagnostics,
			() => false
		);
		if (nodocs) return null;

		return DeclarationJson.parse(declaration);
	}

	return null;
};

/**
 * Infer the fixture category from its path based on directory structure.
 *
 * `module/comment/*` fixtures capture the module comment string; everything
 * else captures a `DeclarationJson` through the production `analyzeDeclaration`
 * (which dispatches on inferred kind — the per-kind extractor is no longer a
 * fixture-side choice).
 */
export const inferCategoryFromName = (name: string): TsFixtureCategory =>
	name.startsWith('module/comment/') ? 'moduleComment' : 'declaration';

/**
 * Load all fixtures from the ts fixtures directory (flat structure).
 */
export const loadFixtures = async (): Promise<Array<TsFixture>> => {
	const genericFixtures = await loadFixturesGeneric<DeclarationJsonInput | string | null>({
		fixturesDir: import.meta.dirname,
		inputExtension: '.ts'
	});

	// Add category inference
	return genericFixtures.map((f) => ({
		...f,
		category: inferCategoryFromName(f.name)
	}));
};
