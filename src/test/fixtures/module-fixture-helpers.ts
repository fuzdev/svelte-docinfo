/**
 * Shared capture machinery for the ts and svelte fixture harnesses.
 *
 * Both harnesses capture the same shape — the whole module analysis object
 * plus the analysis-pass diagnostics — through the same production routing
 * (`analyzeCore` over a one-file source set). This module owns that contract
 * so it can't drift between the two; the harnesses keep only what genuinely
 * diverges (program construction: ts fixtures are self-contained so a
 * `noResolve` program keeps them hermetic and fast, svelte virtuals import
 * `svelte` so they need a real program).
 *
 * Multi-file ts fixtures (sibling files beside `input.ts`) capture the
 * `AnalyzeResultJson` envelope instead — cross-module facts land on more than
 * one module, so the single-module shape can't hold them. That path lives in
 * `ts/ts-test-helpers.ts` (`analyzeFixtureProject`); this module stays the
 * single-module contract.
 */

import type ts from 'typescript';
import { z } from 'zod';

import { ModuleJson } from '$lib/types.ts';
import { Diagnostic } from '$lib/diagnostics.ts';
import { analyzeCore } from '$lib/analyze-core.ts';
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
