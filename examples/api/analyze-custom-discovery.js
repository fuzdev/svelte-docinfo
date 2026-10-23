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

// `analyze()` resolves imports with TypeScript's module resolution by default;
// pass `resolveImport` to use your own resolver.
const { modules } = await analyze({
	sourceFiles: files,
	sourceOptions: createSourceOptions(dir)
});

await writeFile(
	join(dir, 'output-custom-discovery.json'),
	JSON.stringify({ modules }, compactReplacer, '\t')
);

console.log(`Analyzed ${modules.length} modules`);
