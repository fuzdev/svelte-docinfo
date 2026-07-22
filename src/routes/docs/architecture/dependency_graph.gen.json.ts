import type { Gen } from '@fuzdev/gro/gen.ts';
import { analyzeFromFiles } from '$lib/analyze.ts';
import { dirname, join } from 'node:path';

import { compute_layout, type LayoutInput } from './graph_layout.ts';

export const gen: Gen = async ({ origin_id, log }) => {
	const here = dirname(origin_id);
	const project_root = join(here, '..', '..', '..', '..');

	const { modules } = await analyzeFromFiles({
		projectRoot: project_root,
		exclude: ['**/*.test.ts', '**/index.ts'],
		log
	});

	if (modules.length === 0) {
		log.warn(`no modules found at ${project_root}; emitting empty layout`);
	}

	const input: LayoutInput = {
		nodes: modules.map((m) => ({ id: m.path })),
		edges: modules.flatMap((m) => (m.dependencies ?? []).map((dep) => ({ src: m.path, tgt: dep })))
	};

	const layout = compute_layout(input);
	log.info(
		`architecture layout: ${layout.nodes.length} nodes, ${layout.edges.length} edges, ${layout.layer_count} layers`
	);

	return JSON.stringify(layout);
};
