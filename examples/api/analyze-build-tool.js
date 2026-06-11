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
// Helper mimicking what a build tool does per file: id + content + the
// file's resolved source-set dependencies (external imports like 'svelte'
// are not source files and don't belong in the array).
const loadSource = async (relativePath, dependencies = []) => ({
	id: join(dir, relativePath),
	content: await readFile(join(dir, relativePath), 'utf-8'),
	dependencies: dependencies.map((d) => join(dir, d)),
});

const sourceFiles = await Promise.all([
	loadSource('src/lib/math.ts'),
	loadSource('src/lib/shapes.ts'),
	loadSource('src/lib/counter.svelte.ts'),
	loadSource('src/lib/has-issues.ts'),
	loadSource('src/lib/Calculator.svelte', ['src/lib/math.ts']),
	loadSource('src/lib/Card.svelte'),
	loadSource('src/lib/index.ts', [
		'src/lib/Calculator.svelte',
		'src/lib/Card.svelte',
		'src/lib/counter.svelte.ts',
		'src/lib/math.ts',
		'src/lib/shapes.ts',
	]),
]);

// Let analyze() auto-create the TypeScript program with Svelte virtual files
// for full checker-backed component analysis.
const {modules} = await analyze({
	sourceFiles,
	sourceOptions: createSourceOptions(dir),
});

await writeFile(join(dir, 'output-build-tool.json'), JSON.stringify({modules}, compactReplacer, '\t'));

console.log(`Analyzed ${modules.length} modules`);
