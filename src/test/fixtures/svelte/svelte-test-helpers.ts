import type ts from 'typescript';
import { join } from 'node:path';

import { transformSvelteSource, type SvelteVirtualFile } from '$lib/svelte.ts';
import { createAnalysisProgram } from '$lib/typescript-program.ts';
import { analyzeCore } from '$lib/analyze-core.ts';
import { buildAliasRegistry } from '$lib/typescript-alias-registry.ts';
import type { AliasRegistry } from '$lib/typescript-extract-type-json.ts';
import type { SourceFileInfo } from '$lib/source.ts';

import {
	loadFixturesGeneric,
	ModuleFixtureJson,
	type ModuleFixture,
	type ModuleFixtureJsonInput
} from '../../test-helpers.ts';
import { testSourceOptions } from '../../test-module-helpers.ts';

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

/** Run `transformSvelteSource` and unwrap the virtual file or throw. */
export const transformOrThrow = (sourceFile: SourceFileInfo): SvelteVirtualFile => {
	const result = transformSvelteSource(sourceFile);
	if (!result.virtual) {
		throw new Error(
			`transform failed: ${sourceFile.id}: ${result.diagnostics[0]?.message ?? 'unknown error'}`
		);
	}
	return result.virtual;
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
 * Analyze a set of svelte fixture inputs through `analyzeCore` — one shared
 * program over every fixture's virtual (much faster than per-fixture), then
 * the production orchestrator per fixture, so the registry pre-pass, export
 * walk, output passes, and diagnostic boundary sequence are all production
 * code. Per-fixture rather than one batch call so fixtures stay independent
 * projects — no cross-fixture duplicate detection or re-export linking.
 *
 * Each fixture analyzes under a component-named id in the repo's `src/lib`
 * (the file never exists on disk — content is supplied and only the virtual
 * enters the program), so `analyzeCore` derives the module path
 * (`PropsBasic.svelte`) and the virtual's `svelte` imports resolve against
 * the repo's node_modules.
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
			id: join(process.cwd(), 'src/lib', `${fixtureNameToComponentName(name)}.svelte`),
			content: input
		};
		return { sourceFile, virtualFile: transformOrThrow(sourceFile) };
	});

	// Entries carry `scriptKind` so JS-lang fixtures parse as JS (JSDoc types)
	const program = createAnalysisProgram({
		virtualFiles: new Map(entries.map((e) => [e.virtualFile.virtualPath, e.virtualFile]))
	});

	return entries.map(({ sourceFile, virtualFile }) => {
		const { modules, diagnostics } = analyzeCore({
			sourceFiles: [sourceFile],
			sourceOptions,
			program,
			svelteVirtualFiles: new Map([[sourceFile.id, virtualFile]])
		});
		const mod = modules[0];
		if (!mod) throw new Error(`analyzeCore emitted no module for ${sourceFile.id}`);
		if (!mod.declarations.some((d) => d.kind === 'component')) {
			throw new Error(`No component declaration found for ${mod.path}`);
		}
		return { ...mod, diagnostics };
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

/**
 * Validate a fixture's expected module object: parses through the Zod schema —
 * strictly stronger than any hand-rolled structural check and can't fall
 * behind the data model — and requires exactly one component declaration.
 */
export const validateModuleFixture = (expected: ModuleFixtureJsonInput): void => {
	const parsed = ModuleFixtureJson.parse(expected);
	const components = parsed.declarations.filter((d) => d.kind === 'component');
	if (components.length !== 1) {
		throw new Error(`Expected exactly 1 component declaration, got ${components.length}`);
	}
};
