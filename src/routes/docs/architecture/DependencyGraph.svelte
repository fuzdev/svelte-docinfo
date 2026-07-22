<script lang="ts">
	import { library_context } from '@fuzdev/fuz_ui/library.svelte.ts';

	import { dependency_graph as layout } from './dependency_graph.ts';
	import { ZoomPanState } from './zoom_pan_state.svelte.ts';

	const get_library = library_context.get();
	const library = $derived(get_library());

	let hovered: string | null = $state(null);
	let fullscreen = $state(false);

	const zoom = new ZoomPanState({
		min_scale: 0.1,
		max_scale: 8,
		content_width: layout.viewbox.width,
		content_height: layout.viewbox.height
	});

	const on_window_keydown = (e: KeyboardEvent) => {
		if (e.key === 'Escape' && fullscreen) {
			e.preventDefault();
			fullscreen = false;
		}
	};

	// Reset to identity whenever the mode toggles. The SVG handles the base fit
	// via preserveAspectRatio; the inner `<g transform>` adds user zoom on top.
	$effect(() => {
		fullscreen;
		zoom.reset();
	});

	// Relation of each node to the hovered one: `self`, `out` (a dependency the
	// hovered module imports), or `in` (a dependent that imports it). Drives the
	// same blue/orange direction coding on the boxes as on the edges.
	const node_relations = $derived.by(() => {
		if (!hovered) return null;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- fresh map per derivation, never mutated externally
		const m = new Map<string, 'self' | 'in' | 'out'>([[hovered, 'self']]);
		for (const e of layout.edges) {
			if (e.src === hovered) m.set(e.tgt, 'out');
			else if (e.tgt === hovered) m.set(e.src, 'in');
		}
		return m;
	});

	const module_url = (path: string): string | undefined =>
		library.module_by_path.get(path)?.url_api;

	/**
	 * Build an SVG cubic-bezier path through `waypoints`.
	 * Vertical handles produce smooth S-curves when consecutive waypoints differ in x
	 * and collapse to a straight vertical line when they align.
	 */
	const build_path = (waypoints: Array<{ x: number; y: number }>): string => {
		if (waypoints.length < 2) return '';
		const first = waypoints[0]!;
		let d = `M ${first.x} ${first.y}`;
		for (let i = 1; i < waypoints.length; i++) {
			const a = waypoints[i - 1]!;
			const b = waypoints[i]!;
			const dy = b.y - a.y;
			const cy1 = a.y + dy / 2;
			const cy2 = b.y - dy / 2;
			d += ` C ${a.x} ${cy1}, ${b.x} ${cy2}, ${b.x} ${b.y}`;
		}
		return d;
	};

	const edge_key = (e: { src: string; tgt: string }): string => `${e.src}|${e.tgt}`;

	const node_state = (id: string): '' | 'self' | 'in' | 'out' | 'dim' => {
		if (!node_relations) return '';
		return node_relations.get(id) ?? 'dim';
	};

	// `out` = hovered module imports the target (depends-on); `in` = the source
	// imports the hovered module (depended-by). Coloring the two differently makes
	// the direction of each relationship legible on hover.
	const edge_state = (e: { src: string; tgt: string }): '' | 'in' | 'out' | 'dim' => {
		if (!hovered) return '';
		if (e.src === hovered) return 'out';
		if (e.tgt === hovered) return 'in';
		return 'dim';
	};
</script>

<svelte:window onkeydown={on_window_keydown} />

<div class="dependency-graph" class:fullscreen class:has-hover={hovered !== null}>
	<div class="toolbar">
		<button type="button" onclick={() => zoom.reset()} title="Reset view">reset</button>
		<button
			type="button"
			onclick={() => (fullscreen = !fullscreen)}
			title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
		>
			{fullscreen ? 'exit fullscreen' : 'fullscreen'}
		</button>
	</div>

	<div
		class="zoom-host"
		{@attach zoom.input}
		bind:clientWidth={zoom.host_width}
		bind:clientHeight={zoom.host_height}
	>
		<svg
			width={layout.viewbox.width}
			height={layout.viewbox.height}
			viewBox="0 0 {layout.viewbox.width} {layout.viewbox.height}"
			role="img"
			aria-label="svelte-docinfo module dependency graph: {layout.nodes
				.length} modules across {layout.layer_count} layers"
		>
			<defs>
				<marker
					id="arrow"
					viewBox="0 0 10 10"
					refX="9"
					refY="5"
					markerWidth="6"
					markerHeight="6"
					orient="auto-start-reverse"
				>
					<path d="M 0 0 L 10 5 L 0 10 z" class="arrow-head" fill="context-stroke" />
				</marker>
			</defs>

			<g transform={zoom.transform}>
				<g class="edges">
					{#each layout.edges as edge (edge_key(edge))}
						<path
							d={build_path(edge.waypoints)}
							class="edge {edge_state(edge)}"
							marker-end="url(#arrow)"
						/>
					{/each}
				</g>

				<g class="nodes">
					{#each layout.nodes as node (node.id)}
						{@const href = module_url(node.id)}
						{@const cy = node.y + node.height / 2}
						<!-- eslint-disable svelte/no-navigation-without-resolve -->
						<a
							href={href ?? '#'}
							aria-label="{node.id}, layer {node.layer}"
							tabindex="0"
							onmouseenter={() => (hovered = node.id)}
							onmouseleave={() => (hovered = null)}
							onfocus={() => (hovered = node.id)}
							onblur={() => (hovered = null)}
						>
							<!-- eslint-enable svelte/no-navigation-without-resolve -->
							<g class="node {node_state(node.id)}">
								<rect x={node.x} y={node.y} width={node.width} height={node.height} rx="6" ry="6" />
								<text x={node.x + 14} y={cy} class="label" dominant-baseline="central">
									{node.id}
								</text>
							</g>
						</a>
					{/each}
				</g>
			</g>
		</svg>
	</div>
</div>

<style>
	.dependency-graph {
		position: relative;
		width: 100%;
		padding-block: var(--space_md);
	}
	.dependency-graph.fullscreen {
		position: fixed;
		inset: 0;
		z-index: 100;
		padding: 0;
		background: var(--shade_05);
	}

	.toolbar {
		display: flex;
		gap: var(--space_xs);
		justify-content: flex-end;
		margin-bottom: var(--space_xs);
	}
	.fullscreen .toolbar {
		position: absolute;
		top: var(--space_sm);
		right: var(--space_sm);
		margin: 0;
		z-index: 2;
	}

	.zoom-host {
		position: relative;
		overflow: hidden;
		touch-action: none;
		user-select: none;
		cursor: grab;
		width: 100%;
		height: 600px;
		contain: layout paint;
		background: var(--shade_05);
	}
	.zoom-host:active {
		cursor: grabbing;
	}
	.fullscreen .zoom-host {
		height: 100%;
		background: transparent;
	}

	svg {
		display: block;
		width: 100%;
		height: 100%;
	}
	.fullscreen svg {
		height: 100%;
	}

	.edge {
		fill: none;
		stroke: var(--border_color_50);
		stroke-width: 1.2;
		transition:
			opacity 120ms ease,
			stroke 120ms ease,
			stroke-width 120ms ease;
	}
	/* `out` = hovered module's dependencies; `in` = its dependents. Distinct hues
	   (blue/orange — a colorblind-safe pair) read the direction at a glance. */
	.edge.out {
		stroke: var(--color_a_50);
		stroke-width: 2;
	}
	.edge.in {
		stroke: var(--color_f_50);
		stroke-width: 2;
	}
	.has-hover .edge.dim {
		opacity: 0.18;
	}

	.node rect {
		fill: var(--bg_10);
		stroke: var(--border_color_50);
		stroke-width: 1;
		transition:
			fill 120ms ease,
			stroke 120ms ease,
			stroke-width 120ms ease;
	}
	.node .label {
		fill: var(--fg_80);
		font-family: var(--font_family_mono, ui-monospace, monospace);
		font-size: 14px;
		font-weight: 500;
		pointer-events: none;
	}

	a {
		cursor: pointer;
		outline: none;
	}
	a:focus-visible .node rect {
		stroke: var(--color_a_50);
		stroke-width: 2;
	}

	/* Boxes mirror the edge direction coding: `out` dependencies and the hovered
	   node itself in blue, `in` dependents in orange. */
	.node:hover rect,
	.node.self rect,
	.node.out rect {
		fill: var(--bg_20);
		stroke: var(--color_a_50);
		stroke-width: 2;
	}
	.node.in rect {
		fill: var(--bg_20);
		stroke: var(--color_f_50);
		stroke-width: 2;
	}
	.has-hover .node.dim rect {
		opacity: 0.4;
	}
	.has-hover .node.dim .label {
		opacity: 0.4;
	}
</style>
