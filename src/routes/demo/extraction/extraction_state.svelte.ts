import {page} from '$app/state';
import {create_context} from '@fuzdev/fuz_ui/context_helpers.ts';
import type {AnalyzeResultJsonWire} from '$lib/index.js';
import {isCss, isJson, isSvelte} from '$lib/source.ts';

/**
 * Shape of the committed `extraction_data.json` artifact — analysis of the
 * examples/api corpus paired with raw sources, produced by
 * `extraction_data.gen.json.ts`. Serialized through `compactReplacer`, so
 * default-bearing fields may be absent (the wire form).
 */
export interface ExtractionData {
	modules: AnalyzeResultJsonWire['modules'];
	diagnostics?: AnalyzeResultJsonWire['diagnostics'];
	sources: Record<string, string>;
}

/**
 * Which of the three regions is visible in the narrow single-pane layout.
 * Inert on wide screens, where all three render side by side.
 */
export type ExtractionView = 'modules' | 'source' | 'data';

export interface ExtractionStateOptions {
	modules: AnalyzeResultJsonWire['modules'];
	/**
	 * Raw source content keyed by module path, matching `ModuleJson.path`.
	 */
	sources: Record<string, string>;
}

/**
 * Data for the extraction demo, set by its layout and read by sub-pages.
 * Selection derives from the route's `module_path` param,
 * falling back to the first module at the bare `/demo/extraction` root.
 */
export class ExtractionState {
	// defaults are immediately overwritten in the constructor; they exist so
	// the lazily-evaluated `$derived` initializers below satisfy use-before-init
	readonly modules: AnalyzeResultJsonWire['modules'] = [];
	readonly sources: Record<string, string> = {};

	// tab selection for the narrow single-pane layout; ignored on wide screens
	active_view: ExtractionView = $state('modules');

	// the barrel is the natural default at the bare root; fall back to the first module
	readonly default_path: string = $derived(
		this.modules.find((m) => m.path === 'index.ts')?.path ?? this.modules[0]?.path ?? '',
	);
	readonly selected_path: string = $derived(page.params.module_path ?? this.default_path);
	readonly selected_module = $derived(this.modules.find((m) => m.path === this.selected_path));
	readonly selected_source: string = $derived(this.sources[this.selected_path] ?? '');
	readonly selected_lang: string = $derived.by(() => {
		if (isSvelte(this.selected_path)) return 'svelte';
		if (isCss(this.selected_path)) return 'css';
		if (isJson(this.selected_path)) return 'json';
		return 'ts';
	});
	// `modules` is already the compact wire form (the gen file serializes
	// through `compactReplacer`), so pretty-printing it directly shows exactly
	// what consumers get.
	readonly selected_data: string = $derived(
		this.selected_module ? JSON.stringify(this.selected_module, null, '\t') : '',
	);

	constructor(options: ExtractionStateOptions) {
		this.modules = options.modules;
		this.sources = options.sources;
	}
}

export const extraction_context = create_context<ExtractionState>();
