/**
 * Sugiyama-style layered DAG layout for the architecture visualization.
 *
 * Pipeline: break cycles → assign layers (longest-path-from-sink) → insert
 * dummy nodes on long edges → reduce crossings (median heuristic) → assign x
 * within each layer → compute waypoints. Pure functions; the gen wrapper
 * feeds it library.json data and writes the resulting JSON sibling.
 *
 * @module
 */

import {compareStrings} from 'svelte-docinfo/postprocess.js';

export interface LayoutInputNode {
	id: string;
}

export interface LayoutInputEdge {
	src: string;
	tgt: string;
}

export interface LayoutInput {
	nodes: Array<LayoutInputNode>;
	edges: Array<LayoutInputEdge>;
}

export interface LayoutOptions {
	node_height: number;
	node_padding_x: number;
	char_width: number;
	layer_gap_y: number;
	node_gap_x: number;
	canvas_padding: number;
	crossing_passes: number;
}

export const default_layout_options: LayoutOptions = {
	node_height: 36,
	node_padding_x: 14,
	char_width: 8.5,
	layer_gap_y: 64,
	node_gap_x: 24,
	canvas_padding: 32,
	crossing_passes: 12,
};

export interface LayoutNode {
	id: string;
	layer: number;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface LayoutEdge {
	src: string;
	tgt: string;
	/** Polyline anchors in canvas coordinates: source bottom → dummy centers → target top. */
	waypoints: Array<{x: number; y: number}>;
	/** True when the underlying import was reversed to break a cycle. */
	reversed: boolean;
}

export interface Layout {
	viewbox: {width: number; height: number};
	layer_count: number;
	nodes: Array<LayoutNode>;
	edges: Array<LayoutEdge>;
}

const estimate_node_width = (name: string, opts: LayoutOptions): number =>
	Math.ceil(name.length * opts.char_width) + opts.node_padding_x * 2;

interface InternalNode {
	id: string;
	layer: number;
	width: number;
	height: number;
	is_dummy: boolean;
	cx: number;
	cy: number;
}

const median = (values: Array<number>): number => {
	if (values.length === 0) return -1;
	const sorted = [...values].sort((a, b) => a - b);
	const m = sorted.length / 2;
	return sorted.length % 2 === 1
		? (sorted[Math.floor(m)] ?? 0)
		: ((sorted[m - 1] ?? 0) + (sorted[m] ?? 0)) / 2;
};

/**
 * Reverse any back-edges discovered during DFS so the remaining graph is a DAG.
 *
 * @returns the set of `"src|tgt"` keys that were reversed
 */
const break_cycles = (ids: Array<string>, out_edges: Map<string, Array<string>>): Set<string> => {
	const reversed = new Set<string>();
	const visiting = new Set<string>();
	const done = new Set<string>();
	const stack: Array<{n: string; i: number}> = [];
	for (const start of ids) {
		if (done.has(start)) continue;
		stack.push({n: start, i: 0});
		visiting.add(start);
		while (stack.length > 0) {
			const frame = stack[stack.length - 1]!;
			const outs = out_edges.get(frame.n)!;
			if (frame.i >= outs.length) {
				visiting.delete(frame.n);
				done.add(frame.n);
				stack.pop();
				continue;
			}
			const t = outs[frame.i]!;
			frame.i++;
			if (visiting.has(t)) {
				// back-edge → reverse it
				reversed.add(`${frame.n}|${t}`);
				const src_outs = out_edges.get(frame.n)!;
				src_outs.splice(src_outs.indexOf(t), 1);
				frame.i--;
				const tgt_outs = out_edges.get(t)!;
				if (!tgt_outs.includes(frame.n)) tgt_outs.push(frame.n);
			} else if (!done.has(t)) {
				visiting.add(t);
				stack.push({n: t, i: 0});
			}
		}
	}
	return reversed;
};

/** Layer 0 = sinks (foundation, bottom of canvas); layer N = sources (entry, top). */
const assign_layers = (
	ids: Array<string>,
	out_edges: Map<string, Array<string>>,
): Map<string, number> => {
	const layer = new Map<string, number>();
	const compute = (n: string, stack: Set<string>): number => {
		const cached = layer.get(n);
		if (cached !== undefined) return cached;
		if (stack.has(n)) return 0; // defensive; cycles should already be broken
		stack.add(n);
		const outs = out_edges.get(n) ?? [];
		let max = 0;
		for (const t of outs) max = Math.max(max, compute(t, stack) + 1);
		stack.delete(n);
		layer.set(n, max);
		return max;
	};
	for (const id of ids) compute(id, new Set());
	return layer;
};

const reduce_crossings = (
	layers: Array<Array<string>>,
	neighbors_higher: Map<string, Array<string>>,
	neighbors_lower: Map<string, Array<string>>,
	passes: number,
): void => {
	for (let pass = 0; pass < passes; pass++) {
		const sweep_up = pass % 2 === 0;
		const start = sweep_up ? 1 : layers.length - 2;
		const end = sweep_up ? layers.length : -1;
		const step = sweep_up ? 1 : -1;
		for (let i = start; i !== end; i += step) {
			const ref = layers[sweep_up ? i - 1 : i + 1]!;
			const ref_idx = new Map(ref.map((id, idx) => [id, idx] as const));
			const layer = layers[i]!;
			const neighbors = sweep_up ? neighbors_lower : neighbors_higher;
			const ms = new Map<string, number>();
			for (const id of layer) {
				const ns = (neighbors.get(id) ?? [])
					.map((n) => ref_idx.get(n))
					.filter((x): x is number => x !== undefined);
				ms.set(id, median(ns));
			}
			layers[i] = [...layer].sort((a, b) => {
				const ma = ms.get(a) ?? -1;
				const mb = ms.get(b) ?? -1;
				if (ma === -1 && mb === -1) return compareStrings(a, b);
				if (ma === -1) return -1;
				if (mb === -1) return 1;
				if (ma === mb) return compareStrings(a, b);
				return ma - mb;
			});
		}
	}
};

export const compute_layout = (
	input: LayoutInput,
	options: Partial<LayoutOptions> = {},
): Layout => {
	const opts = {...default_layout_options, ...options};

	const ids = input.nodes.map((n) => n.id);
	const id_set = new Set(ids);

	// Build adjacency, filtering edges to known internal nodes
	const out_edges = new Map<string, Array<string>>();
	for (const id of ids) out_edges.set(id, []);
	for (const e of input.edges) {
		if (!id_set.has(e.src) || !id_set.has(e.tgt) || e.src === e.tgt) continue;
		const outs = out_edges.get(e.src)!;
		if (!outs.includes(e.tgt)) outs.push(e.tgt);
	}

	const reversed_keys = break_cycles(ids, out_edges);
	const layer_of = assign_layers(ids, out_edges);
	const layer_count = Math.max(0, ...layer_of.values()) + 1;

	// Build internal node records
	const nodes_map = new Map<string, InternalNode>();
	for (const id of ids) {
		nodes_map.set(id, {
			id,
			layer: layer_of.get(id)!,
			width: estimate_node_width(id, opts),
			height: opts.node_height,
			is_dummy: false,
			cx: 0,
			cy: 0,
		});
	}

	// Insert dummy nodes along edges spanning > 1 layer.
	// We replay edges in their post-reversal direction.
	interface BuiltEdge {
		src: string;
		tgt: string;
		chain: Array<string>;
		reversed: boolean;
	}
	const built: Array<BuiltEdge> = [];
	let dummy_idx = 0;
	for (const src of ids) {
		const src_layer = layer_of.get(src)!;
		for (const tgt of out_edges.get(src) ?? []) {
			const tgt_layer = layer_of.get(tgt)!;
			const chain: Array<string> = [];
			// Edges go from higher layer (source/importer) to lower layer (target).
			// Sanity: src_layer should be >= tgt_layer + 1 after layering.
			for (let l = src_layer - 1; l > tgt_layer; l--) {
				const did = `__dummy_${dummy_idx++}`;
				nodes_map.set(did, {
					id: did,
					layer: l,
					width: 0,
					height: 0,
					is_dummy: true,
					cx: 0,
					cy: 0,
				});
				chain.push(did);
			}
			// Map back to original edge direction for the `reversed` flag
			const was_reversed = reversed_keys.has(`${tgt}|${src}`);
			built.push({
				src: was_reversed ? tgt : src,
				tgt: was_reversed ? src : tgt,
				chain: was_reversed ? [...chain].reverse() : chain,
				reversed: was_reversed,
			});
		}
	}

	// Bucket nodes by layer with deterministic initial ordering (alphabetical, dummies last)
	const layers: Array<Array<string>> = Array.from({length: layer_count}, () => []);
	for (const node of nodes_map.values()) layers[node.layer]!.push(node.id);
	for (const lay of layers) {
		lay.sort((a, b) => {
			const ad = a.startsWith('__dummy_');
			const bd = b.startsWith('__dummy_');
			if (ad !== bd) return ad ? 1 : -1;
			return compareStrings(a, b);
		});
	}

	// Build neighbor maps for crossing reduction.
	// "higher" = greater layer index (toward source/top); "lower" = smaller index.
	const neighbors_higher = new Map<string, Array<string>>(); // edges going up out of a node
	const neighbors_lower = new Map<string, Array<string>>(); // edges going down out of a node
	for (const id of nodes_map.keys()) {
		neighbors_higher.set(id, []);
		neighbors_lower.set(id, []);
	}
	const link = (a: string, b: string) => {
		const a_node = nodes_map.get(a)!;
		const b_node = nodes_map.get(b)!;
		if (a_node.layer > b_node.layer) {
			neighbors_lower.get(a)!.push(b);
			neighbors_higher.get(b)!.push(a);
		} else {
			neighbors_higher.get(a)!.push(b);
			neighbors_lower.get(b)!.push(a);
		}
	};
	for (const e of built) {
		let prev = e.src;
		for (const d of e.chain) {
			link(prev, d);
			prev = d;
		}
		link(prev, e.tgt);
	}

	reduce_crossings(layers, neighbors_higher, neighbors_lower, opts.crossing_passes);

	// Assign x: center each layer's nodes within the canvas content width.
	let max_row_width = 0;
	for (const lay of layers) {
		let w = 0;
		for (let i = 0; i < lay.length; i++) {
			const n = nodes_map.get(lay[i]!)!;
			const cell_w = n.is_dummy ? opts.node_gap_x : n.width;
			w += cell_w;
			if (i < lay.length - 1) w += opts.node_gap_x;
		}
		if (w > max_row_width) max_row_width = w;
	}
	const content_width = max_row_width;
	for (const lay of layers) {
		let row_w = 0;
		for (let i = 0; i < lay.length; i++) {
			const n = nodes_map.get(lay[i]!)!;
			const cell_w = n.is_dummy ? opts.node_gap_x : n.width;
			row_w += cell_w;
			if (i < lay.length - 1) row_w += opts.node_gap_x;
		}
		const start = (content_width - row_w) / 2;
		let x = start;
		for (const id of lay) {
			const n = nodes_map.get(id)!;
			const cell_w = n.is_dummy ? opts.node_gap_x : n.width;
			n.cx = x + cell_w / 2;
			x += cell_w + opts.node_gap_x;
		}
	}

	// Assign y: layer max at top (small y), layer 0 at bottom (large y).
	const row_height = opts.node_height + opts.layer_gap_y;
	const total_height = layer_count * opts.node_height + (layer_count - 1) * opts.layer_gap_y;
	for (const n of nodes_map.values()) {
		const inv = layer_count - 1 - n.layer;
		n.cy = inv * row_height + opts.node_height / 2;
	}

	const viewbox_width = content_width + opts.canvas_padding * 2;
	const viewbox_height = total_height + opts.canvas_padding * 2;
	// Shift everything by canvas_padding so the origin has room
	for (const n of nodes_map.values()) {
		n.cx += opts.canvas_padding;
		n.cy += opts.canvas_padding;
	}

	// Emit real nodes only; dummies live only in edge waypoints
	const out_nodes: Array<LayoutNode> = [];
	for (const id of ids) {
		const n = nodes_map.get(id)!;
		out_nodes.push({
			id,
			layer: n.layer,
			x: n.cx - n.width / 2,
			y: n.cy - n.height / 2,
			width: n.width,
			height: n.height,
		});
	}

	const out_edges_list: Array<LayoutEdge> = [];
	for (const e of built) {
		const src_n = nodes_map.get(e.src)!;
		const tgt_n = nodes_map.get(e.tgt)!;
		// Source anchor: source has higher layer (toward top of canvas, smaller y).
		// Edge exits the BOTTOM of the source rect.
		const waypoints: Array<{x: number; y: number}> = [];
		const src_top = src_n.cy - src_n.height / 2;
		const src_bottom = src_n.cy + src_n.height / 2;
		const tgt_top = tgt_n.cy - tgt_n.height / 2;
		const tgt_bottom = tgt_n.cy + tgt_n.height / 2;
		// In top-down, src layer > tgt layer means src is ABOVE tgt (smaller y).
		// Exit src bottom, enter tgt top.
		// If reversed (back-edge), the rendered arrow still goes src→tgt but logical direction differs.
		const src_y = src_n.layer > tgt_n.layer ? src_bottom : src_top;
		const tgt_y = src_n.layer > tgt_n.layer ? tgt_top : tgt_bottom;
		waypoints.push({x: src_n.cx, y: src_y});
		for (const d of e.chain) {
			const dn = nodes_map.get(d)!;
			waypoints.push({x: dn.cx, y: dn.cy});
		}
		waypoints.push({x: tgt_n.cx, y: tgt_y});
		out_edges_list.push({
			src: e.src,
			tgt: e.tgt,
			waypoints,
			reversed: e.reversed,
		});
	}

	// Round coords for stable JSON output
	const round = (v: number): number => Math.round(v * 100) / 100;
	for (const n of out_nodes) {
		n.x = round(n.x);
		n.y = round(n.y);
	}
	for (const e of out_edges_list) {
		for (const w of e.waypoints) {
			w.x = round(w.x);
			w.y = round(w.y);
		}
	}

	return {
		viewbox: {width: round(viewbox_width), height: round(viewbox_height)},
		layer_count,
		nodes: out_nodes,
		edges: out_edges_list,
	};
};
