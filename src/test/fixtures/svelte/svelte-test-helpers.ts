import type { DeclarationJsonInput } from '$lib/types.ts';

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

	for (const decl of declarations) {
		if (typeof decl.name !== 'string') {
			throw new Error('Expected declaration.name to be a string');
		}
		if (typeof decl.kind !== 'string') {
			throw new Error('Expected declaration.kind to be a string');
		}

		// Component-specific validation
		if (decl.kind === 'component') {
			if (decl.props !== undefined) {
				if (!Array.isArray(decl.props)) {
					throw new Error('Expected component.props to be an array');
				}
				for (const prop of decl.props) {
					if (typeof prop.name !== 'string') {
						throw new Error('Expected prop.name to be a string');
					}
					if (typeof prop.type !== 'string') {
						throw new Error('Expected prop.type to be a string');
					}
				}
			}
		}
	}
};
