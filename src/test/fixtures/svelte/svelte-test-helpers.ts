import type ts from 'typescript';

import { DeclarationJson, type DeclarationJsonInput } from '$lib/types.ts';
import type { SvelteVirtualFile } from '$lib/svelte.ts';
import { buildAliasRegistry } from '$lib/typescript-alias-registry.ts';
import type { AliasRegistry } from '$lib/typescript-extract-type-json.ts';

import { loadFixturesGeneric } from '../../test-helpers.ts';

export interface SvelteFixture {
	name: string;
	input: string;
	/**
	 * All non-nodocs declarations from the module output, in wire (Input)
	 * shape — fixtures are written through `compactReplacer` so defaulted
	 * fields (`.default([])`, `.default(false)`) are stripped on disk.
	 */
	expected: Array<DeclarationJsonInput>;
}

/**
 * Convert a fixture name to a component name.
 * Transforms snake_case to PascalCase and handles directory separators.
 * Examples:
 *   "basic-props" -> "BasicProps"
 *   "component/no-props" -> "ComponentNoProps"
 *   "props/with-descriptions" -> "PropsWithDescriptions"
 *
 * @param name - The fixture name (may include path separators)
 * @returns The component name in PascalCase
 */
export const fixtureNameToComponentName = (name: string): string => {
	// Replace path separators with hyphens, then convert to PascalCase
	return name
		.replace(/[\/\\]/g, '-') // Replace / or \ with -
		.split('-')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join('');
};

/**
 * The svelte harness's twin of `analyzeCore`'s registry pre-pass: build the
 * alias registry over a set of transformed fixtures, reached through their
 * virtuals in `program`. `svelte.test.ts` and the update task must wire
 * identically or fixtures drift from regeneration — both call this.
 */
export const buildSvelteFixtureRegistry = (
	program: ts.Program,
	entries: ReadonlyArray<{ virtualFile: SvelteVirtualFile; modulePath: string }>
): AliasRegistry =>
	buildAliasRegistry(
		entries.map(({ virtualFile, modulePath }) => ({
			sourceFile: program.getSourceFile(virtualFile.virtualPath)!,
			modulePath
		})),
		program.getTypeChecker()
	);

/**
 * Load all fixtures from the svelte fixtures directory.
 */
export const loadFixtures = async (): Promise<Array<SvelteFixture>> => {
	return loadFixturesGeneric<Array<DeclarationJsonInput>>({
		fixturesDir: import.meta.dirname,
		inputExtension: '.svelte'
	});
};

/**
 * Validate that a fixture's declarations have valid structure.
 */
export const validateDeclarationStructures = (declarations: Array<DeclarationJsonInput>): void => {
	if (!Array.isArray(declarations) || declarations.length === 0) {
		throw new Error('Expected declarations to be a non-empty array');
	}

	// Must contain exactly one component
	const components = declarations.filter((d) => d.kind === 'component');
	if (components.length !== 1) {
		throw new Error(`Expected exactly 1 component declaration, got ${components.length}`);
	}

	// Validate through the Zod schema — strictly stronger than any hand-rolled
	// structural check and can't fall behind the data model
	for (const decl of declarations) {
		DeclarationJson.parse(decl);
	}
};
