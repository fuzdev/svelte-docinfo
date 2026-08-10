import type ts from 'typescript';

import type { SvelteVirtualFile } from '$lib/svelte.ts';
import { createAnalysisProgram } from '$lib/typescript-program.ts';
import { buildAliasRegistry } from '$lib/typescript-alias-registry.ts';
import type { AliasRegistry } from '$lib/typescript-extract-type-json.ts';
import type { SourceFileInfo } from '$lib/source.ts';

import { loadFixturesGeneric } from '../../test-helpers.ts';
import { testSourceOptions, transformOrThrow } from '../../test-module-helpers.ts';
import {
	captureModuleFixture,
	fixtureFileId,
	type ModuleFixture,
	type ModuleFixtureJson,
	type ModuleFixtureJsonInput
} from '../module-fixture-helpers.ts';

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
 * virtuals in `program`. For tests driving `analyzeSvelteModule` directly —
 * the fixture pipeline itself (`analyzeSvelteFixtureModules`) goes through
 * `analyzeCore`, which runs the pre-pass internally.
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
 * Analyze a set of svelte fixture inputs through the production pipeline (see
 * `captureModuleFixture`) over one shared program — much faster than
 * per-fixture programs, and svelte virtuals need a real one so their `svelte`
 * imports resolve.
 *
 * Each fixture analyzes under a component-named id in the repo's `src/lib`
 * (the file never exists on disk — content is supplied and only the virtual
 * enters the program), so `analyzeCore` derives the module path
 * (`PropsBasic.svelte`) and resolution runs against the repo's node_modules.
 *
 * Used identically by `svelte.test.ts` and the update task so fixtures can't
 * drift from regeneration; results are index-aligned with `inputs`, each
 * exactly what `expected.json` captures.
 */
export const analyzeSvelteFixtureModules = (
	inputs: ReadonlyArray<{ name: string; input: string }>
): Array<ModuleFixtureJson> => {
	const sourceOptions = testSourceOptions();
	const entries = inputs.map(({ name, input }) => {
		const sourceFile: SourceFileInfo = {
			id: fixtureFileId(process.cwd(), `${fixtureNameToComponentName(name)}.svelte`),
			content: input
		};
		return { sourceFile, virtualFile: transformOrThrow(sourceFile) };
	});

	// Entries carry `scriptKind` so JS-lang fixtures parse as JS (JSDoc types)
	const program = createAnalysisProgram({
		virtualFiles: new Map(entries.map((e) => [e.virtualFile.virtualPath, e.virtualFile]))
	});
	// every call sees the whole virtual set (keyed by source id) so the
	// batch-keyed diagnostic remap covers cross-virtual emissions
	const virtualsBySourceId = new Map(entries.map((e) => [e.sourceFile.id, e.virtualFile]));

	return entries.map(({ sourceFile }) => {
		const mod = captureModuleFixture(sourceFile, program, sourceOptions, virtualsBySourceId);
		if (!mod.declarations.some((d) => d.kind === 'component')) {
			throw new Error(`No component declaration found for ${mod.path}`);
		}
		return mod;
	});
};

/**
 * Load all fixtures from the svelte fixtures directory.
 */
export const loadFixtures = async (): Promise<Array<ModuleFixture>> => {
	return loadFixturesGeneric<ModuleFixtureJsonInput>({
		fixturesDir: import.meta.dirname,
		inputExtension: '.svelte'
	});
};
