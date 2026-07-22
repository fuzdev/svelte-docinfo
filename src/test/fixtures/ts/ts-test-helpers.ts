import ts from 'typescript';

import { DeclarationJson, type DeclarationJsonInput } from '$lib/types.ts';
import type { DeclarationJsonBuild } from '$lib/declaration-build.ts';
import { inferDeclarationKind } from '$lib/typescript-extract-shared.ts';
import { extractFunctionInfo, extractVariableInfo } from '$lib/typescript-extract-function.ts';
import { extractTypeInfo, extractEnumInfo } from '$lib/typescript-extract-type.ts';
import { extractClassInfo } from '$lib/typescript-extract-class.ts';
import { extractModuleComment } from '$lib/typescript-exports.ts';
import { parseComment, applyToDeclaration } from '$lib/tsdoc.ts';
import type { Diagnostic } from '$lib/diagnostics.ts';

import { loadFixturesGeneric } from '../../test-helpers.ts';

export type TsFixtureCategory =
	'function' | 'class' | 'type' | 'variable' | 'enum' | 'moduleComment' | 'error' | 'inferKind';

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
			moduleResolution: ts.ModuleResolutionKind.NodeNext
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
 * Extract a declaration from a TypeScript source file based on the fixture category.
 * Used by both test files and update tasks to ensure consistent behavior.
 *
 * @param sourceFile - The TypeScript source file to analyze
 * @param checker - The TypeScript type checker
 * @param category - The fixture category (function, class, type, etc.)
 * @returns The extracted declaration, or null if not found
 */
export const extractDeclarationFromSource = (
	sourceFile: ts.SourceFile,
	checker: ts.TypeChecker,
	category: TsFixtureCategory
): DeclarationJson | string | null => {
	// Handle moduleComment category differently (returns string, not IdentifierJson)
	if (category === 'moduleComment') {
		return extractModuleComment(sourceFile) ?? null;
	}

	// Find the exported declaration
	for (const statement of sourceFile.statements) {
		// Check if this statement type can have modifiers
		if (
			!ts.isFunctionDeclaration(statement) &&
			!ts.isClassDeclaration(statement) &&
			!ts.isInterfaceDeclaration(statement) &&
			!ts.isTypeAliasDeclaration(statement) &&
			!ts.isEnumDeclaration(statement) &&
			!ts.isVariableStatement(statement)
		) {
			continue;
		}

		const modifiers = ts.getModifiers(statement);
		const isExported = modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword);

		if (!isExported) continue;

		// Get symbol and node
		let symbol: ts.Symbol | undefined;
		let node: ts.Node | undefined;

		if (ts.isFunctionDeclaration(statement) && statement.name) {
			node = statement;
			symbol = checker.getSymbolAtLocation(statement.name);
		} else if (ts.isClassDeclaration(statement) && statement.name) {
			node = statement;
			symbol = checker.getSymbolAtLocation(statement.name);
		} else if (ts.isInterfaceDeclaration(statement)) {
			node = statement;
			symbol = checker.getSymbolAtLocation(statement.name);
		} else if (ts.isTypeAliasDeclaration(statement)) {
			node = statement;
			symbol = checker.getSymbolAtLocation(statement.name);
		} else if (ts.isEnumDeclaration(statement)) {
			node = statement;
			symbol = checker.getSymbolAtLocation(statement.name);
		} else if (ts.isVariableStatement(statement)) {
			// Get the first declaration
			const decl = statement.declarationList.declarations[0];
			if (decl && ts.isIdentifier(decl.name)) {
				node = decl;
				symbol = checker.getSymbolAtLocation(decl.name);
			}
		}

		if (!symbol || !node) continue;

		const name = symbol.name;

		// For inferKind category, just test kind inference
		if (category === 'inferKind') {
			const kind = inferDeclarationKind(symbol, node);
			return DeclarationJson.parse({ name, kind });
		}

		// Create base declaration (plain object, not .parse(), to match production code's key insertion order)
		const declaration: DeclarationJsonBuild = {
			name,
			kind: inferDeclarationKind(symbol, node)
		};

		// Extract TSDoc — parseComment filters @module blocks (handled by extractModuleComment)
		const tsdoc = parseComment(node, sourceFile);

		// Check for @nodocs tag (excludes from documentation)
		const nodocs = tsdoc?.nodocs ?? false;
		if (nodocs) return null;

		// Apply TSDoc to declaration (adds docComment, deprecatedMessage, examples, etc.)
		applyToDeclaration(declaration, tsdoc);

		// Apply appropriate extraction based on category
		const diagnostics: Array<Diagnostic> = [];
		switch (category) {
			case 'function':
				extractFunctionInfo(node, symbol, checker, declaration, tsdoc, diagnostics);
				break;
			case 'class':
				extractClassInfo(node, checker, declaration, diagnostics);
				break;
			case 'type':
				extractTypeInfo(node, checker, declaration, diagnostics, () => false);
				break;
			case 'enum':
				extractEnumInfo(node, checker, declaration, diagnostics);
				break;
			case 'variable':
				extractVariableInfo(node, symbol, checker, declaration, diagnostics);
				break;
		}

		return DeclarationJson.parse(declaration);
	}

	return null;
};

/**
 * Infer the fixture category from its path based on directory structure.
 *
 * New hierarchical structure:
 * - declarations/class/* → class
 * - declarations/interface/* → type
 * - declarations/type/* → type
 * - declarations/function/* → function
 * - declarations/variable/* → variable
 * - parameters/* → function
 * - types/* → type
 * - members/class-* → class
 * - members/interface-* → type
 * - generics/* → type
 * - module/comment/* → moduleComment
 * - errors/* → error
 * - tsdoc/comprehensive → function
 * - tsdoc/deprecated-class → class
 * - tsdoc/see-on-interface → type
 * - tsdoc/example-on-type → type
 * - tsdoc/mutates-on-method → class
 * - tsdoc/nodocs-filtering → function
 */
export const inferCategoryFromName = (name: string): TsFixtureCategory => {
	// Handle hierarchical structure (new format)
	if (name.includes('/')) {
		if (name.startsWith('declarations/class/')) return 'class';
		if (name.startsWith('declarations/interface/')) return 'type';
		if (name.startsWith('declarations/type/')) return 'type';
		if (name.startsWith('declarations/function/')) return 'function';
		if (name.startsWith('declarations/variable/')) return 'variable';
		if (name.startsWith('declarations/enum/')) return 'enum';
		if (name.startsWith('parameters/')) return 'function';
		if (name.startsWith('types/')) return 'type';
		if (name.startsWith('members/class-')) return 'class';
		if (name.startsWith('members/interface-')) return 'type';
		if (name.startsWith('generics/')) return 'type';
		if (name.startsWith('module/comment/')) return 'moduleComment';
		if (name.startsWith('errors/')) return 'error';
		// TSDoc fixtures - map by specific fixture name to declaration type
		if (name === 'tsdoc/comprehensive') return 'function';
		if (name === 'tsdoc/deprecated-bare') return 'function';
		if (name === 'tsdoc/deprecated-class') return 'class';
		if (name === 'tsdoc/see-on-interface') return 'type';
		if (name === 'tsdoc/example-on-type') return 'type';
		if (name === 'tsdoc/mutates-on-method') return 'class';
		if (name === 'tsdoc/nodocs-filtering') return 'function';
		if (name === 'tsdoc/module-tag-excluded') return 'function';
	}

	// Fallback for old flat structure (for backwards compatibility during migration)
	if (name.startsWith('class-')) return 'class';
	if (name.startsWith('function-') || name.startsWith('params_')) return 'function';
	if (name.startsWith('interface-') || name.startsWith('type-')) return 'type';
	if (name.startsWith('variable-')) return 'variable';
	if (name.startsWith('inferKind-')) return 'inferKind';
	if (name.startsWith('module-')) return 'moduleComment';

	throw new Error(`Cannot infer category from fixture name: ${name}`);
};

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

/**
 * Validate that a `DeclarationJsonInput` (wire-form) has the expected structure.
 * Accepts both loaded JSON and `.parse()` results since Output is assignable to Input.
 */
export const validateDeclarationStructure = (declaration: DeclarationJsonInput): void => {
	if (!declaration) {
		throw new Error('Expected declaration to be defined');
	}

	// Must have name and kind
	if (typeof declaration.name !== 'string') {
		throw new Error('Expected declaration.name to be a string');
	}

	if (typeof declaration.kind !== 'string') {
		throw new Error('Expected declaration.kind to be a string');
	}

	// Validate kind is one of the allowed values
	const validKinds = ['function', 'class', 'type', 'interface', 'enum', 'variable', 'component'];
	if (!validKinds.includes(declaration.kind)) {
		throw new Error(`Expected declaration.kind to be one of ${validKinds.join(', ')}`);
	}

	// Validate optional fields based on kind
	if (declaration.kind === 'function') {
		if (declaration.parameters !== undefined && !Array.isArray(declaration.parameters)) {
			throw new Error('Expected parameters to be an array');
		}
		if (declaration.returnType !== undefined && typeof declaration.returnType !== 'string') {
			throw new Error('Expected returnType to be a string');
		}
	}

	if (declaration.kind === 'class') {
		if (declaration.members !== undefined && !Array.isArray(declaration.members)) {
			throw new Error('Expected members to be an array');
		}
	}

	if (declaration.kind === 'type' || declaration.kind === 'interface') {
		if (declaration.members !== undefined && !Array.isArray(declaration.members)) {
			throw new Error('Expected members to be an array');
		}
	}

	// Validate genericParams if present
	if (declaration.genericParams !== undefined) {
		if (!Array.isArray(declaration.genericParams)) {
			throw new Error('Expected genericParams to be an array');
		}
		for (const param of declaration.genericParams) {
			if (typeof param.name !== 'string') {
				throw new Error('Expected generic param name to be a string');
			}
		}
	}

	// Validate overloads if present (function kind)
	if (declaration.kind === 'function') {
		if (declaration.overloads !== undefined) {
			if (!Array.isArray(declaration.overloads)) {
				throw new Error('Expected overloads to be an array');
			}
			for (const overload of declaration.overloads) {
				if (typeof overload.typeSignature !== 'string') {
					throw new Error('Expected overload typeSignature to be a string');
				}
			}
		}
	}

	// Validate overloads on class members if present
	if (declaration.kind === 'class') {
		if (declaration.members !== undefined) {
			for (const member of declaration.members) {
				if (member.kind === 'function' || member.kind === 'constructor') {
					if (member.overloads !== undefined) {
						if (!Array.isArray(member.overloads)) {
							throw new Error(`Expected overloads on member "${member.name}" to be an array`);
						}
						for (const overload of member.overloads) {
							if (typeof overload.typeSignature !== 'string') {
								throw new Error(
									`Expected overload typeSignature on member "${member.name}" to be a string`
								);
							}
						}
					}
				}
			}
		}
	}
};
