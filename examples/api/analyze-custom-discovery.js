/** Custom file discovery - compose helpers for control over glob patterns. */

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyze, createSourceOptions, compactReplacer } from 'svelte-docinfo';
import { globFiles } from 'svelte-docinfo/files.js';

const dir = dirname(fileURLToPath(import.meta.url));

const files = await globFiles({
	projectRoot: dir,
	include: ['src/lib/**/*.{ts,svelte}']
});

// `analyze()` ingests via a single-use AnalysisSession internally. The session
// owns dependency resolution: it lexes import specifiers, resolves them via
// the configured `ImportResolver`, and filters to the source set. The default
// resolver uses TypeScript's module resolution over the session's parsed
// tsconfig options. Supply a custom `resolveImport` to bypass it: a bare
// function (a cache identity is synthesized for you), or an `ImportResolver`
// (`{resolve, identity}`) with a stable `identity` when the same logical
// resolver is rebuilt as a fresh closure (Vite/Rollup plugins).
const { modules } = await analyze({
	sourceFiles: files,
	sourceOptions: createSourceOptions(dir)
});

await writeFile(
	join(dir, 'output-custom-discovery.json'),
	JSON.stringify({ modules }, compactReplacer, '\t')
);

console.log(`Analyzed ${modules.length} modules`);
