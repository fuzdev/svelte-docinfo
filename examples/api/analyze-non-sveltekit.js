/** Non-SvelteKit layout - configure sourcePaths for plain TypeScript libraries. */

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeFromFiles, compactReplacer } from 'svelte-docinfo';

const dir = dirname(fileURLToPath(import.meta.url));

// For a plain TypeScript library with source in src/ (not src/lib/),
// configure sourceOptions to match your layout.
//
// This example analyzes src/utils.ts using src/ as the source root,
// so module paths are relative to src/ (e.g., "utils.ts" not "lib/utils.ts").

const { modules } = await analyzeFromFiles({
	projectRoot: dir,
	// Source lives in src/ instead of the SvelteKit default src/lib/.
	sourceOptions: { sourcePaths: ['src'] },
	// Narrow to src/*.ts only (excludes src/lib/ in this example). Without
	// `include`, the glob fallback derives `src/**/*.{ts,js,svelte,css,json}`
	// from `sourcePaths` and recurses into subdirs. Providing `include`
	// under the default `discovery: 'auto'` collapses the chain to glob
	// immediately and replaces the derived pattern with this explicit one.
	include: ['src/*.ts']
});

await writeFile(
	join(dir, 'output-non-sveltekit.json'),
	JSON.stringify({ modules }, compactReplacer, '\t')
);

console.log(`Analyzed ${modules.length} modules (paths relative to src/)`);
for (const m of modules) {
	console.log(`  ${m.path}: ${m.declarations.length} declarations`);
}
