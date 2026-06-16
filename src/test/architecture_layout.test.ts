/**
 * Tests for the architecture-page dependency graph layout.
 *
 * Two scopes:
 * - Algorithm unit tests on synthetic graphs — layering, cycle handling, DAG invariants
 * - Structural snapshot of the real generated artifact — every library module is
 *   represented as a node, every edge references valid nodes, layer monotonicity holds
 */

import {test, assert, describe} from 'vitest';

import {compute_layout, type LayoutInput} from '$routes/docs/architecture/graph_layout.ts';
import {dependency_graph} from '$routes/docs/architecture/dependency_graph.ts';
import {analyzeFromFiles} from '$lib/index.js';

describe('compute_layout', () => {
	test('synthetic acyclic graph assigns layers from sinks upward', () => {
		// A → B → D → E → F
		//  \→ C ↗
		const input: LayoutInput = {
			nodes: [{id: 'A'}, {id: 'B'}, {id: 'C'}, {id: 'D'}, {id: 'E'}, {id: 'F'}],
			edges: [
				{src: 'A', tgt: 'B'},
				{src: 'A', tgt: 'C'},
				{src: 'B', tgt: 'D'},
				{src: 'C', tgt: 'D'},
				{src: 'D', tgt: 'E'},
				{src: 'E', tgt: 'F'},
			],
		};
		const out = compute_layout(input);

		const layer_of = new Map(out.nodes.map((n) => [n.id, n.layer]));
		assert.strictEqual(layer_of.get('F'), 0);
		assert.strictEqual(layer_of.get('E'), 1);
		assert.strictEqual(layer_of.get('D'), 2);
		assert.strictEqual(layer_of.get('B'), 3);
		assert.strictEqual(layer_of.get('C'), 3);
		assert.strictEqual(layer_of.get('A'), 4);

		// No reversed edges in a clean DAG
		assert(out.edges.every((e) => !e.reversed));

		// Forward layer monotonicity
		for (const e of out.edges) {
			const sl = layer_of.get(e.src)!;
			const tl = layer_of.get(e.tgt)!;
			assert(sl > tl, `edge ${e.src}(L${sl}) → ${e.tgt}(L${tl}) violates layering`);
		}

		// Positive, finite viewbox; all nodes within it
		assert(out.viewbox.width > 0 && out.viewbox.height > 0);
		for (const n of out.nodes) {
			assert(n.x >= 0 && n.y >= 0);
			assert(n.x + n.width <= out.viewbox.width);
			assert(n.y + n.height <= out.viewbox.height);
		}
	});

	test('inserts dummy waypoints on edges spanning multiple layers', () => {
		// A → B → C with an extra A → C skipping B
		const out = compute_layout({
			nodes: [{id: 'A'}, {id: 'B'}, {id: 'C'}],
			edges: [
				{src: 'A', tgt: 'B'},
				{src: 'B', tgt: 'C'},
				{src: 'A', tgt: 'C'},
			],
		});
		const ac = out.edges.find((e) => e.src === 'A' && e.tgt === 'C')!;
		// Endpoints + one dummy midway = 3 waypoints
		assert.strictEqual(ac.waypoints.length, 3);
	});

	test('breaks cycles by reversing one back-edge per loop', () => {
		// A → B → C → A
		const out = compute_layout({
			nodes: [{id: 'A'}, {id: 'B'}, {id: 'C'}],
			edges: [
				{src: 'A', tgt: 'B'},
				{src: 'B', tgt: 'C'},
				{src: 'C', tgt: 'A'},
			],
		});
		assert.strictEqual(out.edges.filter((e) => e.reversed).length, 1);

		const layer_of = new Map(out.nodes.map((n) => [n.id, n.layer]));
		for (const e of out.edges) {
			const sl = layer_of.get(e.src)!;
			const tl = layer_of.get(e.tgt)!;
			if (e.reversed) {
				// Drawn in original direction; the rendered arrow now points upstream
				assert(sl < tl, `reversed edge ${e.src} → ${e.tgt} should have src.layer < tgt.layer`);
			} else {
				assert(sl > tl, `forward edge ${e.src} → ${e.tgt} should have src.layer > tgt.layer`);
			}
		}
	});

	test('ignores edges referencing unknown nodes and self-loops', () => {
		const out = compute_layout({
			nodes: [{id: 'A'}, {id: 'B'}],
			edges: [
				{src: 'A', tgt: 'B'},
				{src: 'A', tgt: 'A'}, // self-loop
				{src: 'A', tgt: 'Z'}, // unknown target
				{src: 'Y', tgt: 'B'}, // unknown source
			],
		});
		assert.strictEqual(out.edges.length, 1);
		assert.strictEqual(out.edges[0]!.src, 'A');
		assert.strictEqual(out.edges[0]!.tgt, 'B');
	});

	test('empty input produces an empty layout with sane viewbox', () => {
		const out = compute_layout({nodes: [], edges: []});
		assert.strictEqual(out.nodes.length, 0);
		assert.strictEqual(out.edges.length, 0);
		assert(out.viewbox.width > 0 && out.viewbox.height > 0);
	});
});

describe('dependency_graph artifact', () => {
	test('every analyzed module appears as a node', async () => {
		const {modules} = await analyzeFromFiles({
			projectRoot: process.cwd(),
			exclude: ['**/*.test.ts', '**/index.ts'],
		});
		const node_ids = new Set(dependency_graph.nodes.map((n) => n.id));
		for (const m of modules) {
			assert(node_ids.has(m.path), `module ${m.path} missing from layout`);
		}
		assert.strictEqual(node_ids.size, modules.length);
	});

	test('every edge references valid nodes', () => {
		const node_ids = new Set(dependency_graph.nodes.map((n) => n.id));
		for (const e of dependency_graph.edges) {
			assert(node_ids.has(e.src), `edge src ${e.src} not in nodes`);
			assert(node_ids.has(e.tgt), `edge tgt ${e.tgt} not in nodes`);
		}
	});

	test('forward edges respect layer monotonicity', () => {
		const layer_of = new Map(dependency_graph.nodes.map((n) => [n.id, n.layer]));
		for (const e of dependency_graph.edges) {
			if (e.reversed) continue;
			const sl = layer_of.get(e.src)!;
			const tl = layer_of.get(e.tgt)!;
			assert(sl > tl, `edge ${e.src}(L${sl}) → ${e.tgt}(L${tl}) violates layering`);
		}
	});

	test('all node coordinates lie within the viewbox', () => {
		const {width, height} = dependency_graph.viewbox;
		for (const n of dependency_graph.nodes) {
			assert(n.x >= 0, `${n.id}.x = ${n.x}`);
			assert(n.y >= 0, `${n.id}.y = ${n.y}`);
			assert(n.x + n.width <= width, `${n.id} extends past viewbox width`);
			assert(n.y + n.height <= height, `${n.id} extends past viewbox height`);
		}
	});
});
