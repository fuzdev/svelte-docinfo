import type {Gen} from '@fuzdev/gro/gen.js';
import type {LibraryJson} from '@fuzdev/fuz_util/library_json.js';
import {readFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';

import {compute_layout, type LayoutInput} from './graph_layout.js';

export const gen: Gen = async ({origin_id, log}) => {
	const here = dirname(origin_id);
	const library_json_path = join(here, '..', '..', 'library.json');
	const raw = await readFile(library_json_path, 'utf8');
	const data: LibraryJson = JSON.parse(raw);

	const modules = data.source_json.modules ?? [];
	if (modules.length === 0) {
		log.warn(`no modules in ${library_json_path}; emitting empty layout`);
	}

	const input: LayoutInput = {
		nodes: modules.map((m) => ({id: m.path})),
		edges: modules.flatMap((m) => (m.dependencies ?? []).map((dep) => ({src: m.path, tgt: dep}))),
	};

	const layout = compute_layout(input);
	log.info(
		`architecture layout: ${layout.nodes.length} nodes, ${layout.edges.length} edges, ${layout.layer_count} layers`,
	);

	return JSON.stringify(layout);
};
