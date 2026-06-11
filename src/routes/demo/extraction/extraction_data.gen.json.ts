import type {Gen} from '@fuzdev/gro/gen.js';
import {readFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {analyzeFromFiles} from 'svelte-docinfo/analyze.js';
import {compactReplacer} from 'svelte-docinfo/declaration-helpers.js';

/**
 * Analyzes the ../../../../examples/api corpus for the extraction demo, pairing
 * each module's analysis output with its raw source in one artifact so the two
 * can never drift apart. Imports `svelte-docinfo` through the package
 * self-reference, so `npm run build` must precede `gro gen` after `src/lib`
 * changes — same constraint as ../../docs/architecture/dependency_graph.gen.json.ts.
 */
export const gen: Gen = async ({origin_id, log}) => {
	const here = dirname(origin_id);
	const project_root = join(here, '..', '..', '..', '..', 'examples', 'api');

	const {modules, diagnostics} = await analyzeFromFiles({projectRoot: project_root, log});

	if (modules.length === 0) {
		log.warn(`no modules found at ${project_root}; emitting empty extraction data`);
	}

	// raw source of each analyzed module, keyed by `ModuleJson.path`
	const sources = Object.fromEntries(
		await Promise.all(
			modules.map(
				async (m) =>
					[m.path, await readFile(join(project_root, 'src/lib', m.path), 'utf-8')] as const,
			),
		),
	);

	// `compactReplacer` keeps `modules` in the same compact wire form the Vite
	// plugin publishes, so the demo shows exactly what consumers get
	return JSON.stringify({modules, diagnostics, sources}, compactReplacer);
};
