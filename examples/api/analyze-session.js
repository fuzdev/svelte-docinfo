/** Persistent session - reuse parsed ASTs across multiple ingest+query cycles (e.g. HMR loops). */

import {readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {createAnalysisSession, createSourceOptions, compactReplacer} from 'svelte-docinfo';

const dir = dirname(fileURLToPath(import.meta.url));

const mathPath = join(dir, 'src/lib/math.ts');
const shapesPath = join(dir, 'src/lib/shapes.ts');
const counterPath = join(dir, 'src/lib/counter.svelte.ts');
const issuesPath = join(dir, 'src/lib/has-issues.ts');
const componentPath = join(dir, 'src/lib/Calculator.svelte');
const cardPath = join(dir, 'src/lib/Card.svelte');
const indexPath = join(dir, 'src/lib/index.ts');

// A session owns a TypeScript LanguageService, a content-keyed source cache,
// and a svelte2tsx virtual cache. Subsequent setFile/query cycles reuse
// parsed ASTs and skip transforms when content is unchanged.
//
// Build-tool integrations that already maintain a dependency graph (Gro's
// filer, Vite's module graph) can opt in to a pre-resolved fast path by
// supplying `SourceFileInfo.dependencies`. The session skips its own
// lex+resolve pass and uses those paths as-is. Cache key for pre-resolved
// entries is `(content, dependencies element-wise equality)` — a fresh array
// with identical contents still cache-hits, which means producing the deps
// array via `[...filer.dependencies.keys()]` per call works cleanly.
const session = createAnalysisSession({
	sourceOptions: createSourceOptions(dir),
});

const buildFiles = async () => [
	{id: mathPath, content: await readFile(mathPath, 'utf-8'), dependencies: []},
	{id: shapesPath, content: await readFile(shapesPath, 'utf-8'), dependencies: []},
	{id: counterPath, content: await readFile(counterPath, 'utf-8'), dependencies: []},
	{id: issuesPath, content: await readFile(issuesPath, 'utf-8'), dependencies: []},
	{
		id: componentPath,
		content: await readFile(componentPath, 'utf-8'),
		dependencies: [mathPath],
	},
	{id: cardPath, content: await readFile(cardPath, 'utf-8'), dependencies: []},
	{
		id: indexPath,
		content: await readFile(indexPath, 'utf-8'),
		dependencies: [componentPath, cardPath, counterPath, mathPath, shapesPath],
	},
];

try {
	// === Cycle 1: cold ingest ============================================
	// Comparable cost to a one-shot analyze() — every file is new to the session.
	const initial = await buildFiles();
	const ingest1 = await session.setFiles(initial);
	console.log(`Cycle 1 (cold):   ${ingest1.changedIds.size} files changed`);
	const cold = session.query();
	console.log(`                  ${cold.modules.length} modules`);

	// Persist the cold output — this is the result equivalent to one-shot APIs,
	// and matches the other examples' output files for the equivalence test.
	await writeFile(
		join(dir, 'output-session.json'),
		JSON.stringify({modules: cold.modules}, compactReplacer, '\t'),
	);

	// === Cycle 2: single-file edit (the δ shape an LSP/HMR consumer drives) ==
	// Simulate an editor saving math.ts with a tweaked docstring. Only that one
	// entry is dirty — `setFile` returns `{changed: true}` for it, and parsed
	// ASTs for the other two files survive untouched.
	const mathSource = await readFile(mathPath, 'utf-8');
	const editedMath = mathSource.replace(
		'Add two numbers.',
		'Add two numbers together.',
	);
	const ingest2 = await session.setFile({
		id: mathPath,
		content: editedMath,
		dependencies: [],
	});
	console.log(`Cycle 2 (edit):   math.ts changed=${ingest2.changed}`);
	const afterEdit = session.query();
	const mathModule = afterEdit.modules.find((m) => m.path === 'math.ts');
	console.log(`                  add(): "${mathModule?.declarations.find((d) => d.name === 'add')?.docComment}"`);

	// === Cycle 3: no-op re-ingest (cache hit) ==========================
	// Re-ingesting the same content + a freshly-constructed deps array hits the
	// cache cleanly — `changed: false`. The shallow-array key means callers
	// producing `[...filer.dependencies.keys()]` per call don't need upstream
	// memoization.
	const ingest3 = await session.setFile({
		id: mathPath,
		content: editedMath,
		dependencies: [],
	});
	console.log(`Cycle 3 (no-op):  math.ts changed=${ingest3.changed} (cached)`);

	// === Cycle 4: deleteFile shrinks the owned set ======================
	await session.deleteFile(issuesPath);
	console.log(`Cycle 4 (delete): owned set has ${session.list().length} files (issues removed)`);
	const afterDelete = session.query();
	console.log(`                  ${afterDelete.modules.length} modules`);

	// In a real Vite/LSP integration the consumer drives setFile per edit and
	// deleteFile per removal, then calls query() when fresh analysis is needed.
} finally {
	// Always dispose — releases LanguageService resources.
	session.dispose();
}
