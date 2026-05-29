/** Custom file discovery - compose helpers for control over glob patterns. */

import {writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {analyze, createSourceOptions, compactReplacer} from 'svelte-docinfo';
import {globFiles} from 'svelte-docinfo/files.js';

const dir = dirname(fileURLToPath(import.meta.url));

const files = await globFiles({
	projectRoot: dir,
	include: ['src/lib/**/*.{ts,svelte}'],
});

// `analyze()` ingests via a single-use AnalysisSession internally. The session
// owns dependency resolution: it lexes import specifiers, resolves them via
// the configured `ImportResolver`, and filters to the source set. The default
// resolver loads tsconfig and uses TypeScript's module resolution. Supply a
// custom `resolveImport` (the `{resolve, identity}` pair) to
// bypass — wrap a bare function like Vite's `pluginContainer.resolveId` with
// a synthesized `identity` string for cache-key purposes.
const {modules} = await analyze({
	sourceFiles: files,
	sourceOptions: createSourceOptions(dir),
});

await writeFile(
	join(dir, 'output-custom-discovery.json'),
	JSON.stringify({modules}, compactReplacer, '\t'),
);

console.log(`Analyzed ${modules.length} modules`);
