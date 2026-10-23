<script lang="ts">
	import TomeContent from '@fuzdev/fuz_ui/TomeContent.svelte';
	import TomeSection from '@fuzdev/fuz_ui/TomeSection.svelte';
	import TomeSectionHeader from '@fuzdev/fuz_ui/TomeSectionHeader.svelte';
	import TomeLink from '@fuzdev/fuz_ui/TomeLink.svelte';
	import DeclarationLink from '@fuzdev/fuz_ui/DeclarationLink.svelte';
	import ModuleLink from '@fuzdev/fuz_ui/ModuleLink.svelte';
	import { tome_get_by_slug } from '@fuzdev/fuz_ui/tome.ts';

	import DependencyGraph from './DependencyGraph.svelte';
	import { dependency_graph } from './dependency_graph.ts';

	const LIBRARY_ITEM_NAME = 'architecture';

	const tome = tome_get_by_slug(LIBRARY_ITEM_NAME);
</script>

<svelte:head>
	<title>architecture - svelte-docinfo</title>
</svelte:head>

<TomeContent {tome}>
	<section>
		<p>
			svelte-docinfo analyzes its own source and draws the result below. Each node is one module
			under <code>src/lib/</code> (the <code>index.ts</code> barrel left out); each arrow is an
			internal import. Click a module to open its API page.
		</p>

		<DependencyGraph />

		<TomeSection>
			<TomeSectionHeader text="How to read it" />
			<ul>
				<li>
					<strong>Arrows</strong> point from importer to imported: <em>X depends on Y</em>. Reads
					with gravity, so dependencies fall downward toward the foundation.
				</li>
				<li>
					<strong>Layers</strong> are assigned by longest-path-from-sink. A module's layer is one
					plus the deepest layer it transitively depends on. Sinks (no internal imports) land at the
					bottom.
				</li>
				<li>
					<strong>Hover</strong> a module to isolate its immediate neighbors. Edges split by
					direction: <span class="swatch swatch-out"></span> what the module <em>depends on</em> and
					<span class="swatch swatch-in"></span> what <em>depends on</em> it.
				</li>
			</ul>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="What the layers say" />
			<p>
				The bottom row is the modules that import nothing else in the library: path and error
				helpers, concurrency caps, logging, the schema helpers, and the Svelte script scanners. The
				middle rows are the per-kind TypeScript extractors and the file-system helpers. The top rows
				are the orchestrators: the persistent <TomeLink slug="session" /> on top of
				<ModuleLink module_path="analyze-core.ts">core analysis</ModuleLink>, then the one-shot
				wrappers and the <TomeLink slug="vite-plugin" /> (both built directly on the session), then
				the <TomeLink slug="cli" /> and its <code>main.ts</code> entry.
			</p>
			<p>
				Across {dependency_graph.nodes.length} modules and {dependency_graph.edges.length} internal
				imports, the graph is naturally acyclic, so no back-edges had to be reversed to lay it out.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="How this was drawn" />
			<p>
				The layout is precomputed at build time by <code>dependency_graph.gen.json.ts</code>, which
				calls <DeclarationLink name="analyzeFromFiles" /> on this project and runs a Sugiyama-style
				layered layout: longest-path-from-sink for layer assignment, dummy nodes on long edges,
				median-heuristic crossing reduction. The result is a small JSON sibling the Svelte component
				renders to SVG. No layout libraries, just a few hundred lines of layout code.
			</p>
		</TomeSection>
	</section>
</TomeContent>

<style>
	.swatch {
		display: inline-block;
		width: 0.85em;
		height: 0.85em;
		border-radius: var(--border_radius_xs);
		vertical-align: middle;
	}
	.swatch-out {
		background: var(--palette_a_50);
	}
	.swatch-in {
		background: var(--palette_h_50);
	}
</style>
