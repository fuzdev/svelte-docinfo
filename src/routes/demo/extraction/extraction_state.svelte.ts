import { page } from '$app/state';
import { create_context } from '@fuzdev/fuz_ui/context_helpers.ts';
import type { AnalyzeResultJsonWire } from '#lib/index.ts';
import { isSvelte } from '#lib/source.ts';

/**
 * Shape of the committed `extraction_data.json` artifact — analysis of the
 * examples/api corpus paired with raw sources, produced by
 * `extraction_data.gen.json.ts`. Serialized through `compactReplacer`, so
 * default-bearing fields may be absent (the wire form).
 */
export interface ExtractionData {
	modules: AnalyzeResultJsonWire['modules'];
	diagnostics?: AnalyzeResultJsonWire['diagnostics'];
	/**
	 * The corpus's source root, relative to its project root. Joins a
	 * `ModuleJson.path` to the project-root-relative `Diagnostic.file`.
	 */
	source_dir: string;
	/**
	 * Raw source content keyed by module path, matching `ModuleJson.path`.
	 */
	sources: Record<string, string>;
}

export type ExtractionDiagnostic = NonNullable<ExtractionData['diagnostics']>[number];

/**
 * Which of the three regions is visible in the narrow single-pane layout.
 * Inert on wide screens, where all three render side by side.
 */
export type ExtractionView = 'modules' | 'source' | 'data';

/**
 * Data for the extraction demo, set by its layout and read by its page.
 * Selection derives from the route's `module_path` param,
 * falling back to the barrel or first module at the bare `/demo/extraction` root.
 */
export class ExtractionState {
	// defaults are immediately overwritten in the constructor; they exist so
	// the lazily-evaluated `$derived` initializers below satisfy use-before-init
	readonly modules: ExtractionData['modules'] = [];
	readonly sources: ExtractionData['sources'] = {};
	readonly diagnostics_by_path: ReadonlyMap<string, Array<ExtractionDiagnostic>> = new Map();

	// tab selection for the narrow single-pane layout; ignored on wide screens
	active_view: ExtractionView = $state('modules');

	// the barrel is the natural default at the bare root; fall back to the first module
	readonly default_path: string = $derived(
		this.modules.find((m) => m.path === 'index.ts')?.path ?? this.modules[0]?.path ?? ''
	);
	// `||` not `??`: the rest param is `''` at the bare root
	readonly selected_path: string = $derived(page.params.module_path || this.default_path);
	readonly selected_module = $derived(this.modules.find((m) => m.path === this.selected_path));
	readonly selected_source: string = $derived(this.sources[this.selected_path] ?? '');
	readonly selected_lang: string = $derived(isSvelte(this.selected_path) ? 'svelte' : 'ts');
	readonly selected_diagnostics: Array<ExtractionDiagnostic> = $derived(
		this.diagnostics_by_path.get(this.selected_path) ?? []
	);
	readonly selected_data: string = $derived(
		this.selected_module ? JSON.stringify(this.selected_module, null, '\t') : ''
	);

	constructor(data: ExtractionData) {
		this.modules = data.modules;
		this.sources = data.sources;
		const prefix = data.source_dir + '/';
		const diagnostics_by_path: Map<string, Array<ExtractionDiagnostic>> = new Map();
		for (const d of data.diagnostics ?? []) {
			if (!d.file.startsWith(prefix)) continue;
			const path = d.file.slice(prefix.length);
			let list = diagnostics_by_path.get(path);
			if (!list) diagnostics_by_path.set(path, (list = []));
			list.push(d);
		}
		this.diagnostics_by_path = diagnostics_by_path;
	}
}

export const extraction_context = create_context<ExtractionState>();
