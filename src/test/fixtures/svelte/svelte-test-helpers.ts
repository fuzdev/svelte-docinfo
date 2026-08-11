import type ts from 'typescript';
import { existsSync } from 'node:fs';
import { posix } from 'node:path';

import type { SvelteVirtualFile } from '$lib/svelte.ts';
import { createAnalysisProgram, type VirtualFileEntry } from '$lib/typescript-program.ts';
import { buildAliasRegistry } from '$lib/typescript-alias-registry.ts';
import type { AliasRegistry } from '$lib/typescript-extract-type-json.ts';
import type { AnalyzeResultJson } from '$lib/analyze-core.ts';
import { ensureLexerReady, lexImports } from '$lib/dep-resolver.ts';
import { isSource } from '$lib/source-config.ts';
import type { SourceFileInfo } from '$lib/source.ts';

import { loadFixturesGeneric, type FixtureExtraFile } from '../../test-helpers.ts';
import { testSourceOptions, transformOrThrow } from '../../test-module-helpers.ts';
import {
	captureFixtureProject,
	captureModuleFixture,
	fixtureFileId,
	resolveFixtureSpecifier,
	type ModuleFixture,
	type ModuleFixtureJson,
	type ModuleFixtureJsonInput
} from '../module-fixture-helpers.ts';

/**
 * Sibling extensions the svelte set collects — unlike the ts set, `.svelte`
 * siblings are analyzable here (the harness transforms them itself). Shared
 * by `loadFixtures` and the update task so the two can't disagree on what a
 * multi-file fixture contains.
 */
export const SVELTE_EXTRA_FILE_EXTENSIONS = ['.ts', '.svelte'];

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
 * The multi-file entry module's path — `<Name>/<Name>.svelte`. The one
 * spelling shared by the harness's regeneration guard and `svelte.test.ts`'s
 * structure validation, so the two can't drift.
 */
export const svelteFixtureEntryPath = (componentName: string): string =>
	`${componentName}/${componentName}.svelte`;

/** One mapped fixture file — a `.svelte` file carries its transform. */
interface SvelteFixtureFile {
	sourceFile: SourceFileInfo;
	/** Present for `.svelte` files; `.ts` siblings enter the program as plain entries. */
	virtualFile?: SvelteVirtualFile;
}

/**
 * One fixture mapped into the synthetic layout — the entry is `files[0]`,
 * and a second file means a multi-file fixture (envelope capture).
 */
interface SvelteFixtureProject {
	componentName: string;
	files: Array<SvelteFixtureFile>;
}

/**
 * Map one fixture's files into the synthetic layout and transform its
 * `.svelte` files.
 *
 * Single-file fixtures keep their flat id (`src/lib/<Name>.svelte` — the
 * shape every existing baseline locks). Multi-file fixtures get a
 * per-fixture namespace dir — `src/lib/<Name>/<Name>.svelte` + verbatim
 * siblings — so sibling names can't collide across fixtures in the one
 * shared program, and because siblings keep their disk-relative position to
 * the entry, `./sibling` specifiers resolve identically on disk (repo
 * typecheck) and in the mapped project. The entry itself is *renamed*
 * (`input.svelte` → `<Name>.svelte`; the ts harness keeps `input.ts`)
 * because the component name derives from the filename — which is why a
 * sibling must never import the entry: no specifier can resolve both on
 * disk and mapped (`analyzeSvelteFixtureModules`' resolver throws on the
 * attempt).
 *
 * Guards: the namespace dir must not exist on disk (unmapped real files
 * inside it would become checker-visible neighbors of fixture files —
 * virtuals win over disk per path, but only for paths the mapping serves),
 * and no sibling may map onto the entry's id (a sibling literally named
 * `<Name>.svelte`).
 */
const mapFixtureProject = (
	name: string,
	input: string,
	extraFiles: ReadonlyArray<FixtureExtraFile> | undefined
): SvelteFixtureProject => {
	const componentName = fixtureNameToComponentName(name);
	const toFile = (id: string, content: string): SvelteFixtureFile => {
		const sourceFile: SourceFileInfo = { id, content };
		return {
			sourceFile,
			virtualFile: id.endsWith('.svelte') ? transformOrThrow(sourceFile) : undefined
		};
	};

	if (!extraFiles?.length) {
		return {
			componentName,
			files: [toFile(fixtureFileId(process.cwd(), `${componentName}.svelte`), input)]
		};
	}

	const namespaceDir = fixtureFileId(process.cwd(), componentName);
	if (existsSync(namespaceDir)) {
		throw new Error(
			`Fixture "${name}": namespace dir exists on disk (${namespaceDir}) — ` +
				'its real files would shape fixture analysis; rename the fixture or the dir'
		);
	}
	const files = [
		toFile(`${namespaceDir}/${componentName}.svelte`, input),
		...extraFiles.map((f) => toFile(`${namespaceDir}/${f.path}`, f.content))
	];
	if (new Set(files.map((f) => f.sourceFile.id)).size !== files.length) {
		throw new Error(
			`Fixture "${name}": a sibling named ${componentName}.svelte maps onto the entry's id — rename it`
		);
	}
	return { componentName, files };
};

/**
 * Throw when any file of a multi-file fixture imports the entry. The entry is
 * renamed (`input.svelte` → `<Name>.svelte`), so an import of the
 * fixture-root `input.svelte` cannot resolve both on disk and mapped — and it
 * must be checked over *every* file, gated `internal/` siblings included
 * (those aren't dep-lexed, so a resolver-side guard would miss them and the
 * import would silently degrade to an error type). Resolution-based, so a
 * *nested* sibling legitimately named `input.svelte` (`./sub/input.svelte`)
 * passes. Lexer-rejected content is skipped — the capture surfaces
 * `import_parse_failed` for it.
 */
const assertNoEntryImports = (project: SvelteFixtureProject): void => {
	const entryUnmappedId = posix.join(
		posix.dirname(project.files[0]!.sourceFile.id),
		'input.svelte'
	);
	for (const file of project.files) {
		const contentToLex = file.virtualFile?.content ?? file.sourceFile.content;
		let specifiers: Array<string>;
		try {
			specifiers = lexImports(contentToLex, file.sourceFile.id);
		} catch {
			continue;
		}
		for (const specifier of specifiers) {
			if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue;
			if (posix.join(posix.dirname(file.sourceFile.id), specifier) === entryUnmappedId) {
				throw new Error(
					`Fixture file imports the entry (${specifier} from ${file.sourceFile.id}) — ` +
						'the entry imports siblings, never the reverse'
				);
			}
		}
	}
};

/**
 * Analyze a set of svelte fixture inputs through the production pipeline (see
 * `captureModuleFixture` / `captureFixtureProject`) over one shared program —
 * much faster than per-fixture programs, and svelte virtuals need a real one
 * so their `svelte` imports resolve.
 *
 * Each fixture analyzes under component-named ids in the repo's `src/lib`
 * (no file exists on disk — content is supplied and only virtuals enter the
 * program), so `analyzeCore` derives the module path (`PropsBasic.svelte`;
 * multi-file `<Name>/<Name>.svelte`) and resolution runs against the repo's
 * node_modules. A fixture with sibling files captures the
 * `AnalyzeResultJson` envelope over its own emitted set — gated `.svelte`
 * siblings (the `internal/` convention) ride `contextSvelteFiles` as
 * canonical-fill context, mirroring `session.query`'s assembly — while
 * single-file fixtures keep the `ModuleFixtureJson` shape.
 *
 * Used identically by `svelte.test.ts` and the update task so fixtures can't
 * drift from regeneration; results are index-aligned with `inputs`, each
 * exactly what `expected.json` captures.
 */
export const analyzeSvelteFixtureModules = async (
	inputs: ReadonlyArray<{ name: string; input: string; extraFiles?: Array<FixtureExtraFile> }>
): Promise<Array<ModuleFixtureJson | AnalyzeResultJson>> => {
	const sourceOptions = testSourceOptions();

	// Two fixture paths can PascalCase to one component name, and mapped ids
	// would then silently last-win in the shared maps below — fail loudly.
	// Ahead of the mapping, so a name clash reports as itself rather than as
	// whichever guard `mapFixtureProject` happens to trip first.
	const fixtureNamesByComponent = new Map<string, string>();
	for (const { name } of inputs) {
		const componentName = fixtureNameToComponentName(name);
		const clash = fixtureNamesByComponent.get(componentName);
		if (clash !== undefined) {
			throw new Error(
				`Fixtures "${clash}" and "${name}" both map to component name ${componentName} — rename one`
			);
		}
		fixtureNamesByComponent.set(componentName, name);
	}

	const projects = inputs.map(({ name, input, extraFiles }) =>
		mapFixtureProject(name, input, extraFiles)
	);

	await ensureLexerReady();

	// One shared program over every fixture's files: svelte virtuals keyed by
	// virtual path (entries carry `scriptKind` so JS-lang fixtures parse as
	// JS), ts siblings keyed by their mapped id as plain entries.
	const programEntries = new Map<string, VirtualFileEntry>();
	for (const project of projects) {
		for (const file of project.files) {
			if (file.virtualFile) {
				programEntries.set(file.virtualFile.virtualPath, file.virtualFile);
			} else {
				programEntries.set(file.sourceFile.id, { content: file.sourceFile.content });
			}
		}
	}
	const program = createAnalysisProgram({ virtualFiles: programEntries });

	// every call sees the whole virtual set (keyed by source id) so the
	// batch-keyed diagnostic remap covers cross-virtual emissions
	const virtualsBySourceId = new Map(
		projects.flatMap((p) =>
			p.files.flatMap((f) => (f.virtualFile ? [[f.sourceFile.id, f.virtualFile] as const] : []))
		)
	);

	// The regeneration guard: the module must carry the fixture's *own*
	// component — name-matched, because a component re-export alias is itself
	// a `kind: 'component'` declaration and would satisfy a kind-only check.
	const assertOwnComponent = (
		declarations: ReadonlyArray<{ kind: string; name: string }>,
		componentName: string,
		where: string
	): void => {
		if (!declarations.some((d) => d.kind === 'component' && d.name === componentName)) {
			throw new Error(`Missing the fixture's own component ${componentName} in ${where}`);
		}
	};

	return Promise.all(
		projects.map(async (project) => {
			if (project.files.length === 1) {
				const mod = captureModuleFixture(
					project.files[0]!.sourceFile,
					program,
					sourceOptions,
					virtualsBySourceId
				);
				assertOwnComponent(mod.declarations, project.componentName, mod.path);
				return mod;
			}

			assertNoEntryImports(project);
			// No `nodeModulesRoot`: externals here are the repo's real packages,
			// which are never mapped ids, so bare specifiers resolve to nothing.
			const fileIds = new Set(project.files.map((f) => f.sourceFile.id));
			const result = await captureFixtureProject({
				sourceFiles: project.files
					.filter((f) => isSource(f.sourceFile.id, sourceOptions))
					.map((f) => f.sourceFile),
				program,
				sourceOptions,
				resolveImport: (specifier, containingFile) =>
					resolveFixtureSpecifier(specifier, containingFile, fileIds),
				svelteVirtualFiles: virtualsBySourceId,
				contextSvelteFiles: project.files
					.filter((f) => f.virtualFile && !isSource(f.sourceFile.id, sourceOptions))
					.map((f) => f.sourceFile)
			});
			const entryPath = svelteFixtureEntryPath(project.componentName);
			const entryModule = result.modules.find((m) => m.path === entryPath);
			if (!entryModule) throw new Error(`Missing entry module ${entryPath}`);
			assertOwnComponent(entryModule.declarations, project.componentName, entryPath);
			return result;
		})
	);
};

/**
 * Load all fixtures from the svelte fixtures directory.
 */
export const loadFixtures = async (): Promise<Array<ModuleFixture>> => {
	return loadFixturesGeneric<ModuleFixtureJsonInput>({
		fixturesDir: import.meta.dirname,
		inputExtension: '.svelte',
		loadExtraFiles: true,
		extraFileExtensions: SVELTE_EXTRA_FILE_EXTENSIONS
	});
};
