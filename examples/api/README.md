# API Examples

Six scripts showing different ways to use the API,
from a single function call to full control over file discovery and diagnostics.

| Script                        | When to use                                                                |
| ----------------------------- | -------------------------------------------------------------------------- |
| `analyze-simple.js`           | Most projects — one function call handles everything                       |
| `analyze-custom-discovery.js` | Custom glob patterns and file discovery                                    |
| `analyze-build-tool.js`       | Build tool integration where you already have files in memory              |
| `analyze-diagnostics.js`      | Error handling, duplicate detection, diagnostic inspection                 |
| `analyze-non-sveltekit.js`    | Non-SvelteKit layouts — custom `sourcePaths` and source root               |
| `analyze-session.js`          | Persistent session — reuse parsed ASTs across calls (HMR, LSP-style tools) |

## Dependencies

This example lists `svelte` and `svelte2tsx` as explicit dependencies because
the `file:../..` link doesn't auto-install peer dependencies — those two are
the only peer deps of `svelte-docinfo`. Everything else (`typescript`,
`tinyglobby`, `es-module-lexer`, `@jridgewell/trace-mapping`) is a regular
dependency of `svelte-docinfo` and is installed transitively.

## Run

```bash
npm install
npm run analyze          # run all six examples
npm run analyze:simple   # run just the simple example
```

## Simple

The easiest way to use svelte-docinfo. Pass a project root and it discovers
source files automatically — `package.json` exports first (when present),
glob fallback otherwise:

```js
import {analyzeFromFiles} from 'svelte-docinfo';

const {modules} = await analyzeFromFiles({projectRoot: dir});
```

See [analyze-simple.js](analyze-simple.js) for the full script.

## Custom discovery

When you need control over which files are analyzed, glob the files yourself
and hand them to `analyze`. It ingests via a single-use `AnalysisSession`
internally, which owns import lexing and dependency resolution:

```js
const sourceOptions = createSourceOptions(dir);
const files = await globFiles({projectRoot: dir, include: ['src/lib/**/*.{ts,svelte}']});
const {modules} = await analyze({sourceFiles: files, sourceOptions});
```

See [analyze-custom-discovery.js](analyze-custom-discovery.js) for the full script
with all imports and setup.

## Build tool integration

If your build tool already has file contents in memory,
pass them directly to `analyze` to skip file discovery entirely:

```js
const sourceFiles = [{id: '/path/to/file.ts', content: '...', dependencies: ['/path/to/dep.ts']}];
const {modules} = await analyze({sourceFiles, sourceOptions: createSourceOptions(dir)});
```

See [analyze-build-tool.js](analyze-build-tool.js) for the full script. The
`dependencies` field is an opt-in optimization: when supplied, the session
treats it as authoritative pre-resolved absolute paths and skips its own
lex+resolve pass for that file. Omit the field to fall back to the default
lex+resolve path (the right choice when you don't already have a graph).

## Diagnostics

svelte-docinfo collects warnings and errors without halting,
so you can inspect problems in batch after analysis completes:

```js
import {analyzeFromFiles, errorsOf, hasErrors} from 'svelte-docinfo';

const {modules, diagnostics} = await analyzeFromFiles({
	projectRoot: dir,
	onDuplicates: 'throw',
});

if (hasErrors(diagnostics)) {
	for (const d of errorsOf(diagnostics)) {
		console.error(`[${d.kind}] ${d.file}:${d.line ?? '?'} - ${d.message}`);
	}
}
```

`diagnostics` is a plain `Array<Diagnostic>` — inner entries conform to the
schema by construction (no re-`.parse()` at the envelope boundary) and are
round-trip-safe through `JSON.stringify` / `z.array(Diagnostic).parse` (or
the full envelope via `AnalyzeResultJson.parse`). Use the free helpers
(`hasErrors`, `hasWarnings`, `errorsOf`, `warningsOf`, `byKind`) for queries.

See [analyze-diagnostics.js](analyze-diagnostics.js) for the full script.

## Session

For long-lived consumers (a Vite plugin reacting to file edits, an LSP-style
tool) `createAnalysisSession` returns a persistent handle backed by a TypeScript
`LanguageService`. The incremental API maps cleanly onto LSP `didOpen`/`didChange`/
`didDelete`: ingest current state with `setFile` / `setFiles`, drop with
`deleteFile`, run analysis with `query`. Cache hits (unchanged content + same
resolver identity) are no-ops; only files whose content changed pay re-analysis
cost:

```js
const session = createAnalysisSession({sourceOptions: createSourceOptions(dir)});
try {
	// Initial ingest of the source set.
	await session.setFiles(sourceFiles);
	const first = session.query();

	// ...later, after a file change on disk:
	await session.setFile({id: changedPath, content: newContent});
	const second = session.query();

	// ...or a delete:
	await session.deleteFile(removedPath);
	const third = session.query();
} finally {
	session.dispose();
}
```

`setFile`/`setFiles` return ingest-time diagnostics (`transform_failed`,
`source_map_failed`, `import_parse_failed`, `resolver_failed`); `query` returns
analysis-pass diagnostics. The two are disjoint subsets — concat is safe.
`session.has(id)` and `session.list()` introspect the owned set. The one-shot
`analyze` and `analyzeFromFiles` are thin wrappers over single-use sessions.

See [analyze-session.js](analyze-session.js) for the full script.

## Non-SvelteKit layout

For plain TypeScript libraries that don't use SvelteKit's `src/lib/` convention,
configure `sourcePaths` to match your project layout:

```js
const {modules} = await analyzeFromFiles({
	projectRoot: dir,
	sourceOptions: {sourcePaths: ['src']},
	include: ['src/*.ts'],
});
```

Module paths are relative to the source root — with `sourcePaths: ['src']`,
a file at `src/utils.ts` gets path `"utils.ts"` in the output.

See [analyze-non-sveltekit.js](analyze-non-sveltekit.js) for the full script.

## Source files

The examples analyze source files in `src/lib/` (SvelteKit layout) and `src/` (plain layout):

- `src/lib/math.ts` — TypeScript functions, interfaces, and JSDoc comments
- `src/lib/Calculator.svelte` — Svelte 5 component with typed props
- `src/utils.ts` — plain TypeScript library source (non-SvelteKit example)
