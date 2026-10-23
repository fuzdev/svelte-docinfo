# svelte-docinfo

[<img src="static/logo.svg" alt="a cyan scroll with curling ends" align="right" width="192" height="192">](https://svelte-docinfo.fuz.dev/)

> static analysis for TypeScript and Svelte 📜
> [**svelte-docinfo.fuz.dev**](https://svelte-docinfo.fuz.dev/)

svelte-docinfo extracts JSON describing the exports
of TypeScript and Svelte modules for open-ended use cases
like docs, code search, and dev tools.
It uses the TypeScript compiler API
and [svelte2tsx](https://github.com/sveltejs/language-tools/tree/master/packages/svelte2tsx)
to resolve types, track exports+imports, and extract semantic details.
It includes a Vite plugin, CLI, and programmatic API
in the [npm package](https://www.npmjs.com/package/svelte-docinfo).

```bash
npm i -D svelte-docinfo
```

Peer dependencies: `svelte` 5+, `svelte2tsx`, and `typescript` 5.9+ or 6,
plus an optional `vite` 6+ for the Vite plugin.

- [Quick start](#quick-start)
- [Vite plugin](#vite-plugin)
- [CLI](#cli)
- [API](#api)
- [Features](#features)
- [Documentation](#documentation)
- [Credits](#credits)
- [Contributing](#contributing)
- [License](#license)

svelte-docinfo is largely inspired by [`sveld`](https://github.com/carbon-design-system/sveld),
but instead of AST-only inspection it uses the TypeScript compiler API for richer information,
and also analyzes TypeScript modules.
The docs [compare](https://svelte-docinfo.fuz.dev/docs/introduction#Compared-to-sveld) them.

The library is mostly complete for Svelte 5 and used in production websites,
but you may find gaps and flaws -- please open issues for bugs
and [discussions](https://github.com/fuzdev/svelte-docinfo/discussions)
for everything else!

Dependencies are minimal and the tool's scope is limited to data, not presentation.
The [docs website](https://svelte-docinfo.fuz.dev/docs/api)
for svelte-docinfo is made using itself
and [fuz_ui](https://github.com/fuzdev/fuz_ui) components.

**AI disclosure:** the code and docs beyond the intro
were mostly written by Claude Code with uneven human guidance.
The first release took 5 months of intermittent work and ~500 manual commits
to [extract its initial implementation from fuz_ui](https://github.com/fuzdev/fuz_ui/pull/107),
which was more limited, lacking the fancy TS compiler usage, and grew slowly over years without AI assistance.

## Quick start

Given a project with a `tsconfig.json` (at or above the project root) and two files,
`src/lib/math.ts`:

```ts
/**
 * Add two numbers.
 * @param a - first number
 * @param b - second number
 * @returns the sum
 */
export const add = (a: number, b: number): number => a + b;
```

and `src/lib/Calculator.svelte`:

```svelte
<!--
	@component
	Calculator component for demonstrating Svelte analysis.
-->
<script lang="ts">
	let {
		result = $bindable(0),
		mode = 'add',
		disabled = false
	}: {
		/** Current result (bindable). */
		result?: number;
		/** Operation mode. */
		mode?: 'add' | 'multiply';
		/** Disable the calculator. */
		disabled?: boolean;
	} = $props();
</script>
```

Three ways to integrate `svelte-docinfo`:

1. [Vite plugin](#vite-plugin) - recommended for SvelteKit and Vite projects. Serves a virtual module that stays current in dev mode:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import svelteDocinfo from 'svelte-docinfo/vite.js';

export default defineConfig({ plugins: [sveltekit(), svelteDocinfo()] });
// then anywhere in your app:
// import {modules} from 'virtual:svelte-docinfo';
```

2. [CLI](#cli) - quick analysis from the command line, useful for ad-hoc inspection and shell pipelines:

```bash
npx svelte-docinfo --pretty
```

3. [API](#api) - programmatic access for build tools, custom pipelines, and standalone scripts:

```ts
import { analyzeFromFiles } from 'svelte-docinfo';

const { modules } = await analyzeFromFiles({ projectRoot: process.cwd() });
```

All three produce the same `AnalyzeResultJson` data. The CLI emits it compacted, as shown
here (the Vite module compacts `modules` only); the API returns it with defaults filled in:

```json
{
	"modules": [
		{
			"path": "Calculator.svelte",
			"declarations": [
				{
					"name": "Calculator",
					"kind": "component",
					"docComment": "Calculator component for demonstrating Svelte analysis.",
					"sourceLine": 5,
					"props": [
						{
							"name": "result",
							"type": "number",
							"optional": true,
							"description": "Current result (bindable).",
							"defaultValue": "0",
							"bindable": true
						},
						{
							"name": "mode",
							"type": "\"add\" | \"multiply\"",
							"typeInfo": {
								"kind": "union",
								"members": [
									{ "kind": "literal", "value": "add", "text": "\"add\"" },
									{ "kind": "literal", "value": "multiply", "text": "\"multiply\"" }
								]
							},
							"optional": true,
							"description": "Operation mode.",
							"defaultValue": "'add'"
						},
						{
							"name": "disabled",
							"type": "boolean",
							"optional": true,
							"description": "Disable the calculator.",
							"defaultValue": "false"
						}
					]
				}
			]
		},
		{
			"path": "math.ts",
			"declarations": [
				{
					"name": "add",
					"kind": "function",
					"docComment": "Add two numbers.",
					"typeSignature": "(a: number, b: number): number",
					"sourceLine": 7,
					"parameters": [
						{ "name": "a", "type": "number", "description": "first number" },
						{ "name": "b", "type": "number", "description": "second number" }
					],
					"returnType": "number",
					"returnDescription": "the sum"
				}
			]
		}
	]
}
```

The compact form leaves out defaulted fields: empty arrays (like `diagnostics` here) and
`false` flags. To restore them and validate the shape, parse it with `parseAnalyzeResult`
(`parseModuleJson` for one module, `parseDiagnostics` for diagnostics alone):

```ts
import { parseAnalyzeResult } from 'svelte-docinfo';

const { modules, diagnostics } = parseAnalyzeResult(JSON.parse(json));
```

The parse helpers are the stable entry point. The schemas behind them (`AnalyzeResultJson`,
`ModuleJson`, `DeclarationJson`, …) are exported too, as [valibot](https://valibot.dev/) schemas.

The [extraction demo](https://svelte-docinfo.fuz.dev/demo/extraction) has more examples,
and see the docs for the complete [output format](https://svelte-docinfo.fuz.dev/docs/output-format).
You may also want to browse the [test fixtures](https://github.com/fuzdev/svelte-docinfo/tree/main/src/test/fixtures).

## Vite plugin

Requires Vite 6 or later.

1. Add the plugin to `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import svelteDocinfo from 'svelte-docinfo/vite.js';

export default defineConfig({
	plugins: [sveltekit(), svelteDocinfo()]
});
```

2. Add TypeScript support in `app.d.ts`:

```ts
/// <reference types="svelte-docinfo/virtual-svelte-docinfo.js" />
```

3. Import the virtual module anywhere in your app:

```ts
import { modules, diagnostics } from 'virtual:svelte-docinfo';
// or: import data from 'virtual:svelte-docinfo';
```

Plugin options:

| Option                | Default                                              | Description                                                                                                                                                                                                            |
| --------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projectRoot`         | Vite's resolved `config.root`                        | Absolute path to project root.                                                                                                                                                                                         |
| `include`             | —                                                    | Glob patterns to include (relative to `projectRoot`; absolute inside it accepted). Collapses `discovery: 'auto'` to glob; combining with `discovery: 'exports'` throws. Widens the source scope — see the notes below. |
| `exclude`             | `['**/*.test.ts', '**/*.spec.ts', '**/internal/**']` | Glob patterns to exclude. An array fully replaces the defaults; the callback form extends them (`(defaults) => [...defaults, '**/*.gen.ts']`). The always-on baseline below still applies.                             |
| `discovery`           | `'auto'`                                             | Discovery strategy: `'auto'` \| `'exports'` \| `'glob'`. `'exports'` is strict and fails if `package.json` exports is missing or resolves to no files.                                                                 |
| `distDir`             | `'dist'`                                             | Dist directory name for exports-based discovery.                                                                                                                                                                       |
| `sourceOptions`       | `{sourcePaths: ['src/lib'], …}`                      | Partial overrides for default source options (SvelteKit `src/lib` layout).                                                                                                                                             |
| `resolveDependencies` | `true`                                               | Resolve import dependencies. When `false`, `dependencies`/`dependents` stay empty.                                                                                                                                     |
| `hmrDebounceMs`       | `100`                                                | Dev re-analysis debounce delay in milliseconds.                                                                                                                                                                        |
| `onDuplicates`        | —                                                    | Opt-in check that names are unique across modules, for packages with a flat export namespace: `'diagnostic'` \| `'warn'` \| `'throw'`. Off by default.                                                                |
| `tsconfig`            | `'tsconfig.json'`                                    | Path to the tsconfig, relative to `projectRoot` and searched upward from it, or `false` to analyze without one (built-in strict options, with `compilerOptions` merged on top). |
| `compilerOptions`     | —                                                    | Compiler options merged over the tsconfig's, per key. |
| `rootFileNames`       | the tsconfig's roots                                 | The program's root files in place of the tsconfig's: a list, or a function over the tsconfig's roots (`declarationFileRoots`, from `svelte-docinfo/typescript-program.js`, keeps the declaration files). Narrowing speeds up cold analysis; an ambient type declared in a dropped root resolves to `any`. |

Source-scope notes (shared with the [CLI](#cli) and `analyzeFromFiles`):

- `include` **widens the source scope**: each pattern's static base joins `sourceOptions.sourcePaths`, so the files it finds emit modules (with paths relative to the widened set's common root) and the dev watcher tracks them. A pattern with no base (`'**/*.ts'`, a literal root file) makes the whole project root source and logs an info line.
- Beneath any `exclude`, `node_modules` and dot-directories below a source path are never source. The rule is relative to the source path, so an explicit dot-directory source path (`sourcePaths: ['.hidden/src']`) still works. `dist`, `build`, and `coverage` are ordinary names.
- **`src/lib/internal/`** holds modules that ship for public modules to import but aren't documented, excluded by the default `**/internal/**` pattern. Packages typically block consumer imports with an `"./internal/*": null` exports entry, which exports discovery honors with Node's best-match semantics. Internal modules stay live in dev: editing one re-analyzes the public modules that use it. A public re-export of an internal symbol documents as a full declaration at the re-export site. To document them anyway: `exclude: (defaults) => defaults.filter((p) => p !== '**/internal/**')`.
- Paths and patterns resolve against `projectRoot`. Absolute entries inside the root are accepted, and anything outside it **throws** at options creation instead of silently emitting nothing. `'/src/lib'` is filesystem-absolute, not shorthand for `'src/lib'`.

The options interface is `VitePluginSvelteDocinfoOptions` from `svelte-docinfo/vite.js` (not re-exported from the main barrel).
See the [Vite plugin docs](https://svelte-docinfo.fuz.dev/docs/vite-plugin) and [examples/vite/](examples/vite/README.md) for more.

> If TypeScript reports `Cannot find module 'virtual:svelte-docinfo'`, ensure the `/// <reference>` line is in your `app.d.ts`.

## CLI

```bash
npx svelte-docinfo                    # analyze cwd, print JSON to stdout
npx svelte-docinfo -o output.json     # write to a file instead
npx svelte-docinfo ./packages/my-lib  # analyze a specific directory
npx svelte-docinfo --pretty           # pretty-print the JSON output
```

Output is compact JSON by default. Use `--pretty` for readable output,
or pipe through `jq` for queries:

```bash
npx svelte-docinfo | jq '.modules | length'                  # count modules
npx svelte-docinfo | jq -r '.modules[].declarations[].name'  # list all exported names
```

Info messages print to stderr; only JSON goes to stdout. The terminal interleaves
them visually, but `>` and `|` capture clean JSON. Use `-q`/`--quiet` to suppress info on
stderr (warnings and errors still print).

All CLI options:

| Flag                        | Description                                                                                                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[project-root]`            | Project root directory (default: cwd)                                                                                                                                                         |
| `-i, --include <pattern>`   | Include pattern (repeatable, replaces exports discovery, widens the source scope; incompatible with `--discovery exports`)                                                                    |
| `-e, --exclude <pattern>`   | Exclude glob, applied at discovery and analysis (repeatable; fully replaces the defaults `**/*.test.ts`, `**/*.spec.ts`, `**/internal/**` — no merge; the always-on baseline applies beneath) |
| `-o, --output <file>`       | Output file (default: stdout; pass `-` for explicit stdout, so `-o "$OUT"` works when `$OUT=-`)                                                                                               |
| `--discovery <mode>`        | `auto` \| `exports` \| `glob` (default: `auto` — exports first, glob fallback). `exports` is strict and fails if package.json exports is missing or resolves to no files                      |
| `--dist-dir <dir>`          | Dist directory for exports discovery (default: dist)                                                                                                                                          |
| `--source-dir <dir>`        | Source directory, relative to project root or absolute inside it (default: src/lib). Repeatable for monorepos; drives the implicit include glob when no `--include` is provided               |
| `--source-root <dir>`       | Source root for module-path stripping (default: single source-dir or longest common prefix; pass `.` for project-relative paths)                                                              |
| `--only <pattern>`          | Glob filter applied to module paths in output (repeatable). Full project is still analyzed (re-exports/dependents stay correct); diagnostics aren't filtered                                  |
| `--no-resolve-dependencies` | Disable dependency resolution                                                                                                                                                                 |
| `--pretty`                  | Pretty-print JSON output (default: compact)                                                                                                                                                   |
| `--tsconfig <path>`         | Path to the tsconfig, relative to project root and searched upward from it (default: `tsconfig.json`) |
| `--no-tsconfig`             | Analyze without a tsconfig, using built-in strict compiler options |
| `-q, --quiet`               | Suppress info messages on stderr (warnings and errors still print)                                                                                                                            |
| `--on-duplicates <mode>`    | Opt-in check that names are unique across modules, for packages with a flat export namespace: `diagnostic` \| `warn` \| `throw` (default: off)                                                |
| `-V, --version`             | Show version number                                                                                                                                                                           |
| `-h, --help`                | Show help                                                                                                                                                                                     |

The [Vite plugin](#vite-plugin)'s source-scope notes apply here too, with `--include`, `--exclude`, and `--source-dir` in place of the options. `--exclude` always replaces the defaults (there's no callback form), so to document `internal/`, re-list the others: `-e '**/*.test.ts' -e '**/*.spec.ts'`.

Exit codes: 0 (success), 1 (analysis errors), 2 (a usage error, like an unknown flag or a
missing or invalid option value, or a thrown analysis error, like a missing or unloadable
`tsconfig.json`).

See the [CLI docs](https://svelte-docinfo.fuz.dev/docs/cli) and [examples/cli/](examples/cli/README.md) for more.

## API

Three entry points, same `AnalyzeResultJson` shape (`{modules, diagnostics}`):

| Function                | Use when                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `analyzeFromFiles`      | One-shot. Standalone projects — handles file discovery and dependency resolution                  |
| `analyze`               | One-shot. Build-tool integration — you supply `SourceFileInfo[]` already in memory                |
| `createAnalysisSession` | Incremental. Long-lived consumers (Vite plugin, LSP-style tools) reusing parsed ASTs across calls |

For most projects, `analyzeFromFiles` is all you need. It reads your `package.json` exports
to discover source files, falling back to glob patterns:

```ts
import { analyzeFromFiles } from 'svelte-docinfo';

const { modules } = await analyzeFromFiles({ projectRoot: process.cwd() });
```

Pass `include` for custom patterns or `discovery: 'glob'` to always use glob.
Use `discovery: 'exports'` for strict mode that throws if `package.json` has no usable `exports` field.
When you already have file contents in memory,
use `analyze` instead of `analyzeFromFiles` to skip file discovery.
For just the discovery step (without running analysis), use
`discoverSourceFiles` (also in the main `svelte-docinfo` import).

For long-lived consumers (a Vite plugin reacting to file edits, an LSP-style tool),
`createAnalysisSession` returns a persistent handle that reuses parsed ASTs across calls
— see the [session docs](https://svelte-docinfo.fuz.dev/docs/session) and
[examples/api/analyze-session.js](examples/api/analyze-session.js).

See [examples/api/](examples/api/README.md) for more patterns
including custom discovery, diagnostics, sessions, and error handling.

Import from `svelte-docinfo` for the common API,
or from subpaths like `svelte-docinfo/typescript-exports.js` for lower-level access.
See the [API docs](https://svelte-docinfo.fuz.dev/docs/api) for the full reference.

## Features

- **Full type resolution**: generics, imported types, and inferred return types, without manual annotations
- **Structured types**: an optional `typeInfo` tree (`TypeJson`) beside the flat type strings, with union and intersection members (alias names kept), type arguments, and array/tuple elements. Absent where the flat string says everything; `typeJsonToTokens`/`typeJsonToText` render it
- **Alias-lost name recovery**: TypeScript drops the name of an alias over an indexed access or conditional (`z.infer<typeof S>`, valibot's `v.InferOutput<typeof S>`) and expands it at every use. `typeInfo` recovers it as `{kind: 'reference', name}`, from the written annotation or from a registry of the project's exported aliases. Losses nothing recovers surface as `alias_lost` warnings
- **TSDoc/JSDoc**: `@param`, `@returns`, `@throws`, `@example`, `@deprecated`, `@internal`, `@see`, `@since`, `@default`, `@module`, plus the custom `@nodocs` (exclude from docs) and `@mutates`; `@return` and `@defaultValue` parse as synonyms. `@internal` is a marker (`internalMessage`), not an exclusion. Inline `{@link}` survives in the text
- **Merged value+type symbols**: `const Foo = z.strictObject({...})` + `type Foo = z.infer<typeof Foo>` documents the type, with `mergedValue: true` marking the name as also a runtime value; JSDoc falls back to the const's
- **Svelte 5 components**: prop types, descriptions, defaults, bindability, and callback signatures via svelte2tsx, plus generics and `acceptsChildren`. JS components take props from the JSDoc `@type` on `$props()` or infer them from the destructuring
- **External types**: props and members from external packages (`HTMLButtonAttributes`) are filtered out and named in `externalTypes` (on components, type aliases, interfaces, and classes, including bags reached through local base types), unless the `$props()` destructuring names them
- **Svelte 5 snippets**: `kind: 'snippet'` for snippets exported from `<script module>`, with structured parameters
- **Runes**: `$state`, `$state.raw`, `$derived`, and `$derived.by` on variables and class fields (`reactivity`), detected syntactically in any file
- **Classes, enums, and overloads**: public and protected class members (`private` and `#` excluded), regular and const enums with member values, and every public overload signature with its own JSDoc
- **Re-exports**: `alsoExportedFrom` on canonical declarations and `ModuleJson.reExports` on barrels, `aliasOf` for renames, `starExports`, `kind: 'namespace'` for `export * as ns`, and external re-exports, with `resolveExportSurface()` combining them using ES star semantics
- **Dependency graphs**: imports between modules and the computed dependents
- **Source locations**: the source line of every declaration
- **Build-tool agnostic**: files can come from disk, a build pipeline, or memory
- **Diagnostics**: warnings and errors accumulate without halting; `partial: true` flags incomplete declarations

Known gaps:

- Svelte context (`setContext`/`getContext`) isn't captured yet; investigation is planned, and
  a [request](https://github.com/fuzdev/svelte-docinfo/discussions) would bump its priority
- standalone `namespace Foo {}` declarations document as a bare variable with no members, and decorators aren't modeled
- legacy `export let` components document their props (all `bindable`), and a legacy component's default `<slot />` sets `acceptsChildren` (a runes component's is ignored), but named slots, slot props, events, and `$$restProps` aren't modeled
- `@nodocs` applies to declarations and export statements only; on a member or component prop it's ignored without a warning

[Issues](https://github.com/fuzdev/svelte-docinfo/issues) for bugs and
[discussions](https://github.com/fuzdev/svelte-docinfo/discussions) are welcome!

## Documentation

- [svelte-docinfo.fuz.dev](https://svelte-docinfo.fuz.dev/) - docs site with guides, options reference, and API docs
- [examples/vite/](examples/vite/README.md) - Vite plugin with live reload in dev
- [examples/cli/](examples/cli/README.md) - CLI usage and piping
- [examples/api/](examples/api/README.md) - API usage patterns

## Credits

[`sveld`](https://github.com/carbon-design-system/sveld)
(by Eric Liu, [@metonym](https://github.com/metonym))
was this project's main inspiration.

Extracted from [fuz_ui](https://github.com/fuzdev/fuz_ui),
which has example components using the data for docs websites like
[`DeclarationDetail`](https://github.com/fuzdev/fuz_ui/blob/main/src/lib/DeclarationDetail.svelte).

`svelte-docinfo` is more featureful than it would be
otherwise thanks to LLM assistance, mostly Claude Code.

Built on [TypeScript](https://github.com/microsoft/TypeScript) and
[svelte2tsx](https://github.com/sveltejs/language-tools/tree/master/packages/svelte2tsx),
see [package.json](package.json) for full dependencies.

## Contributing

[fuz.dev/contributing](https://www.fuz.dev/contributing)

## License

[0BSD](LICENSE)
