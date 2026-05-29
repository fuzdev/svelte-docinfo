/** Build tool integration - construct SourceFileInfo when your build tool provides file data. */

import {readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {analyze, createSourceOptions, compactReplacer} from 'svelte-docinfo';

const dir = dirname(fileURLToPath(import.meta.url));

// Build tools typically have a dependency graph already (Vite's module graph,
// Gro's filer, Rollup's bundle inputs). Pass the resolved absolute paths via
// `SourceFileInfo.dependencies` to skip svelte-docinfo's own lex+resolve pass
// for those files — the session uses the supplied paths as-is (after filtering
// node_modules and tests via `isSource`).
const sourceFiles = [
	{
		id: join(dir, 'src/lib/math.ts'),
		content: await readFile(join(dir, 'src/lib/math.ts'), 'utf-8'),
		dependencies: [],
	},
	{
		id: join(dir, 'src/lib/has-issues.ts'),
		content: await readFile(join(dir, 'src/lib/has-issues.ts'), 'utf-8'),
		dependencies: [],
	},
	{
		id: join(dir, 'src/lib/Calculator.svelte'),
		content: await readFile(join(dir, 'src/lib/Calculator.svelte'), 'utf-8'),
		dependencies: [join(dir, 'src/lib/math.ts')],
	},
];

// Let analyze() auto-create the TypeScript program with Svelte virtual files
// for full checker-backed component analysis.
const {modules} = await analyze({
	sourceFiles,
	sourceOptions: createSourceOptions(dir),
});

await writeFile(join(dir, 'output-build-tool.json'), JSON.stringify({modules}, compactReplacer, '\t'));

console.log(`Analyzed ${modules.length} modules`);
