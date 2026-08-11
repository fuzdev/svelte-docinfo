/**
 * Shared capture machinery for the ts and svelte fixture harnesses.
 *
 * Both harnesses capture the same shapes through the same production routing
 * (`analyzeCore`), and this module owns both contracts so they can't drift
 * between the two: single-file fixtures capture `ModuleFixtureJson` (the
 * whole module analysis object plus the analysis-pass diagnostics, via
 * `captureModuleFixture`), multi-file fixtures the `AnalyzeResultJson`
 * envelope (via `captureFixtureProject` — cross-module facts land on more
 * than one module, so the single-module shape can't hold them). The harnesses
 * keep only what genuinely diverges: file mapping and program construction
 * (ts fixtures are self-contained so a `noResolve` program keeps them
 * hermetic and fast, svelte virtuals import `svelte` so they need a real
 * program).
 */

import type ts from 'typescript';
import { z } from 'zod';
import { posix } from 'node:path';

import { ModuleJson } from '$lib/types.ts';
import { Diagnostic } from '$lib/diagnostics.ts';
import {
	analyzeCore,
	normalizeDiagnosticPaths,
	type AnalyzeResultJson
} from '$lib/analyze-core.ts';
import { ensureLexerReady, lexImports } from '$lib/dep-resolver.ts';
import { to_error_message } from '$lib/error.ts';
import { computeDependents } from '$lib/postprocess.ts';
import type { SvelteVirtualFile } from '$lib/svelte.ts';
import type { SourceFileInfo } from '$lib/source.ts';
import type { ModuleSourceOptions } from '$lib/source-config.ts';

import type { GenericFixture } from '../test-helpers.ts';

/**
 * The fixture harnesses' capture shape: the whole module analysis object plus
 * the analysis-pass diagnostics — what `expected.json` holds for both the ts
 * and svelte fixture sets. `ModuleJson` extended rather than the
 * `AnalyzeResultJson` envelope because a fixture is exactly one module; the
 * envelope's `modules` array would add a wrapper level with no information.
 *
 * Fixtures are written through `compactReplacer`, so defaulted fields
 * (`.default([])`, `.default(false)`) are stripped on disk and restored by
 * `.parse()`.
 */
export const ModuleFixtureJson = ModuleJson.extend({
	diagnostics: z.array(Diagnostic).default([])
});
export type ModuleFixtureJson = z.infer<typeof ModuleFixtureJson>;
/** Wire (serialized) form of `ModuleFixtureJson` — the shape read from disk. */
export type ModuleFixtureJsonInput = z.input<typeof ModuleFixtureJson>;

/**
 * A loaded module fixture: raw input beside the expected wire-form
 * `ModuleFixtureJson`.
 */
export type ModuleFixture = GenericFixture<ModuleFixtureJsonInput>;

/**
 * Build a fixture's synthetic file id. The `src/lib` segment is load-bearing:
 * it is `DEFAULT_SOURCE_OPTIONS.sourcePaths`, so an id anywhere else fails
 * the query-time source gate and the fixture emits no module. Neither
 * harness's id exists on disk — content is supplied to analysis directly.
 */
export const fixtureFileId = (projectRoot: string, basename: string): string =>
	`${projectRoot}/src/lib/${basename}`;

/**
 * Capture one fixture's module through `analyzeCore` — the production
 * orchestrator over a one-file source set, so the registry pre-pass, export
 * walk, kind dispatch, `@nodocs` filter, output passes, and diagnostic
 * boundary sequence are all production code and fixtures can't drift from
 * real output. Per fixture rather than one batch call so fixtures stay
 * independent projects — no cross-fixture duplicate detection or re-export
 * linking.
 */
export const captureModuleFixture = (
	sourceFile: SourceFileInfo,
	program: ts.Program,
	sourceOptions: ModuleSourceOptions,
	svelteVirtualFiles: ReadonlyMap<string, SvelteVirtualFile> = new Map()
): ModuleFixtureJson => {
	const { modules, diagnostics } = analyzeCore({
		sourceFiles: [sourceFile],
		sourceOptions,
		program,
		svelteVirtualFiles
	});
	const mod = modules[0];
	if (!mod) throw new Error(`analyzeCore emitted no module for ${sourceFile.id}`);
	return { ...mod, diagnostics };
};

/**
 * Resolve an import specifier against a fixture project's mapped file set.
 *
 * Relative specifiers resolve from the importing file's directory (exact —
 * which covers `.svelte` siblings — `.js` → `.ts` swap, appended
 * `.ts`/`.d.ts`, `index` fallbacks); bare specifiers resolve into
 * `nodeModulesRoot` the same way (`extpkg` → `<root>/extpkg/index.ts`,
 * `pkg/sub` → `<root>/pkg/sub.ts`). Returns `undefined` for anything the set
 * doesn't contain — mirroring an unresolvable import, which analysis
 * tolerates. The ts harness points `nodeModulesRoot` at its synthetic
 * project's `node_modules/` (where the `external/` subdir maps) and uses the
 * same function in its program host; the svelte harness has no such mapping —
 * its externals are the repo's real packages, which never enter `fileIds` —
 * so it omits the argument and every bare specifier resolves to nothing.
 * Exactly right either way: external edges never land in
 * `ModuleJson.dependencies`.
 */
export const resolveFixtureSpecifier = (
	specifier: string,
	containingFile: string,
	fileIds: ReadonlySet<string>,
	nodeModulesRoot?: string
): string | undefined => {
	const relative = specifier.startsWith('./') || specifier.startsWith('../');
	if (!relative && nodeModulesRoot === undefined) return undefined;
	const base = relative
		? posix.join(posix.dirname(containingFile), specifier)
		: `${nodeModulesRoot}/${specifier}`;
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
 * Resolves a lexed import specifier against a fixture project's file set, or
 * `undefined` when it doesn't resolve there. The harness closes over its
 * mapped ids (typically via `resolveFixtureSpecifier`).
 */
export type ResolveFixtureImport = (
	specifier: string,
	containingFile: string
) => string | undefined;

/** Options for `captureFixtureProject`. */
export interface CaptureFixtureProjectOptions {
	/**
	 * The emitted set — every mapped file that becomes a module, without
	 * `dependencies` (this capture resolves them). Gated files stay out and
	 * reach the checker through the program alone (gated *Svelte* files
	 * additionally ride `contextSvelteFiles`).
	 */
	sourceFiles: ReadonlyArray<SourceFileInfo>;
	program: ts.Program;
	sourceOptions: ModuleSourceOptions;
	resolveImport: ResolveFixtureImport;
	/** Svelte virtuals keyed by source id — the `analyzeCore` map. */
	svelteVirtualFiles?: ReadonlyMap<string, SvelteVirtualFile>;
	/** Gated Svelte files as canonical-fill context — see `AnalyzeCoreInputs`. */
	contextSvelteFiles?: ReadonlyArray<SourceFileInfo>;
}

/**
 * Capture a multi-file fixture through `analyzeCore` as the whole
 * `AnalyzeResultJson` envelope — the multi-file twin of
 * `captureModuleFixture`, shared by both harnesses so they can't drift on
 * what `dependencies` means.
 *
 * Input assembly mirrors `session.query`: each emitted file's dependencies
 * are pre-resolved with the production lexer over the session's
 * content-to-lex rule (the svelte2tsx *virtual* for Svelte files — raw
 * svelte isn't lex-able as TS — the file itself otherwise), resolved via
 * `resolveImport`, filtered to the emitted set, deduped in first-occurrence
 * order; `computeDependents` derives the reverse edges. The harness is
 * thereby the pre-resolved-deps caller the session documents (type-only
 * edges kept, like default lex+resolve).
 */
export const captureFixtureProject = async (
	options: CaptureFixtureProjectOptions
): Promise<AnalyzeResultJson> => {
	const {
		sourceFiles,
		program,
		sourceOptions,
		resolveImport,
		svelteVirtualFiles,
		contextSvelteFiles
	} = options;
	await ensureLexerReady();
	const emittedIds = new Set(sourceFiles.map((f) => f.id));
	const ingestDiagnostics: Array<Diagnostic> = [];
	const withDependencies: Array<SourceFileInfo> = sourceFiles.map(({ id, content }) => {
		const contentToLex = svelteVirtualFiles?.get(id)?.content ?? content;
		// the session's phase-1 shape (`import_parse_failed`) — lexer-rejected
		// content is a capturable diagnostic, not a batch crash
		let specifiers: Array<string> = [];
		try {
			specifiers = lexImports(contentToLex, id);
		} catch (err) {
			ingestDiagnostics.push({
				kind: 'import_parse_failed',
				file: id,
				message: `Failed to parse imports: ${to_error_message(err)}`,
				severity: 'warning'
			});
		}
		const resolved = specifiers
			.map((specifier) => resolveImport(specifier, id))
			.filter((dep): dep is string => dep !== undefined && emittedIds.has(dep));
		return { id, content, dependencies: [...new Set(resolved)] };
	});
	const result = analyzeCore({
		sourceFiles: computeDependents(withDependencies),
		sourceOptions,
		program,
		svelteVirtualFiles: svelteVirtualFiles ?? new Map(),
		contextSvelteFiles
	});
	if (ingestDiagnostics.length > 0) {
		normalizeDiagnosticPaths(ingestDiagnostics, sourceOptions.projectRoot);
		// ingest-time before query-time — the session/analyze concat order
		result.diagnostics.unshift(...ingestDiagnostics);
	}
	return result;
};

/**
 * Validate a fixture's expected module object: parses through the Zod schema —
 * strictly stronger than any hand-rolled structural check and can't fall
 * behind the data model. `components` additionally requires that exact count
 * of component declarations (the svelte set requires exactly one).
 */
export const validateModuleFixture = (
	expected: ModuleFixtureJsonInput,
	options?: { components?: number }
): void => {
	const parsed = ModuleFixtureJson.parse(expected);
	if (options?.components !== undefined) {
		const components = parsed.declarations.filter((d) => d.kind === 'component');
		if (components.length !== options.components) {
			throw new Error(
				`Expected exactly ${options.components} component declaration(s), got ${components.length}`
			);
		}
	}
};
