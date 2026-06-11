# svelte-docinfo

[<img src="static/logo.svg" alt="a cyan scroll with curling ends" align="right" width="192" height="192">](https://svelte-docinfo.fuz.dev/)

> static analysis for TypeScript and Svelte 📜
> [**svelte-docinfo.fuz.dev**](https://svelte-docinfo.fuz.dev/)

svelte-docinfo extracts JSON describing the exports
of TypeScript and Svelte modules for open-ended use cases
like docs, code search, and dev tools.
It uses
[svelte2tsx](https://github.com/sveltejs/language-tools/tree/master/packages/svelte2tsx)
and the TypeScript compiler API to resolve types, track exports+imports, and extract semantic details.
It includes a Vite plugin, CLI, and programmatic API
in the [npm package](https://www.npmjs.com/package/svelte-docinfo).

```bash
npm i -D svelte-docinfo
```

- [Quick start](#quick-start)
- [Vite plugin](#vite-plugin)
- [CLI](#cli)
- [API](#api)
- [Features](#features)
- [Documentation](#documentation)
- [Credits](#credits)
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
The first release took 5 months of intermittent work and ~500 manual commits.

## Quick start

Given a project with a couple of files in `src/lib/`:

```ts
// src/lib/math.ts

/**
 * Add two numbers.
 * @param a - first number
 * @param b - second number
 * @returns the sum
 */
export const add = (a: number, b: number): number => a + b;
```

```svelte
<!-- src/lib/Calculator.svelte -->

<!--
	@component
	Calculator component for demonstrating Svelte analysis.
-->
<script lang="ts">
	let {
		result = $bindable(0),
		mode = 'add',
		disabled = false,
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

1. [Vite plugin](#vite-plugin) - recommended for SvelteKit and Vite projects. Serves a virtual module with HMR in dev mode:

```ts
// vite.config.ts
import svelteDocinfo from 'svelte-docinfo/vite.js';

export default defineConfig({plugins: [sveltekit(), svelteDocinfo()]});
// then anywhere in your app:
// import {modules} from 'virtual:svelte-docinfo';
```

2. [CLI](#cli) - quick analysis from the command line, useful for ad-hoc inspection and shell pipelines:

```bash
npx svelte-docinfo --pretty
```

3. [API](#api) - programmatic access for build tools, custom pipelines, and standalone scripts:

```ts
import {analyzeFromFiles} from 'svelte-docinfo';

const {modules} = await analyzeFromFiles({projectRoot: process.cwd()});
```

All three produce the same JSON shape:

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
						{"name": "a", "type": "number", "description": "first number"},
						{"name": "b", "type": "number", "description": "second number"}
					],
					"returnType": "number",
					"returnDescription": "the sum"
				}
			]
		}
	]
}
```

For examples of source input paired with the exact JSON `svelte-docinfo` emits:

- see svelte-docinfo's own source code's extracted JSON at
  [svelte-docinfo.fuz.dev/demo/extraction](https://svelte-docinfo.fuz.dev/demo/extraction)
- browse the [test fixtures](https://github.com/fuzdev/svelte-docinfo/tree/main/src/test/fixtures)

## Vite plugin

1. Add the plugin to `vite.config.ts`:

```ts
import {defineConfig} from 'vite';
import {sveltekit} from '@sveltejs/kit/vite';
import svelteDocinfo from 'svelte-docinfo/vite.js';

export default defineConfig({
	plugins: [sveltekit(), svelteDocinfo()],
});
```

2. Add TypeScript support in `app.d.ts`:

```ts
/// <reference types="svelte-docinfo/virtual-svelte-docinfo.js" />
```

3. Import the virtual module anywhere in your app:

```ts
import {modules, diagnostics} from 'virtual:svelte-docinfo';
// or: import data from 'virtual:svelte-docinfo';
```

Plugin options:

| Option                | Default                            | Description                                                                                                                                |
| --------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `projectRoot`         | Vite's resolved `config.root`      | Absolute path to project root.                                                                                                             |
| `include`             | —                                  | Glob patterns to include (relative to `projectRoot`). Collapses `discovery: 'auto'` to glob; combining with `discovery: 'exports'` throws. |
| `exclude`             | `['**/*.test.ts', '**/*.spec.ts']` | Glob patterns to exclude (fully replaces defaults — does not merge with `**/*.test.ts`, `**/*.spec.ts`).                                   |
| `discovery`           | `'auto'`                           | Discovery strategy: `'auto'` \| `'exports'` \| `'glob'`. `'exports'` is strict and fails if `package.json` exports is missing or empty.    |
| `distDir`             | `'dist'`                           | Dist directory name for exports-based discovery.                                                                                           |
| `sourceOptions`       | `{sourcePaths: ['src/lib'], …}`    | Partial overrides for default source options (SvelteKit `src/lib` layout).                                                                 |
| `resolveDependencies` | `true`                             | Resolve import dependencies. When `false`, `dependencies`/`dependents` stay empty.                                                         |
| `onDuplicates`        | —                                  | Dispatch on duplicate declaration names: `'throw'` \| `'warn'` \| callback. Diagnostic emits regardless of dispatch.                       |
| `hmrDebounceMs`       | `100`                              | HMR debounce delay in milliseconds.                                                                                                        |

The options interface is `VitePluginSvelteDocinfoOptions` from `svelte-docinfo/vite.js` (not re-exported from the main barrel).
See the [docs site](https://svelte-docinfo.fuz.dev/) and [examples/vite/](examples/vite/README.md) for more.

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

| Flag                        | Description                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `[project-root]`            | Project root directory (default: cwd)                                                                                                                        |
| `-i, --include <pattern>`   | Include pattern (repeatable, replaces exports discovery; incompatible with `--discovery exports`)                                                            |
| `-e, --exclude <pattern>`   | Exclude glob, applied at discovery and analysis (repeatable; fully replaces defaults — does not merge with `**/*.test.ts`, `**/*.spec.ts`)                   |
| `-o, --output <file>`       | Output file (default: stdout; pass `-` for explicit stdout, so `-o "$OUT"` works when `$OUT=-`)                                                              |
| `--discovery <mode>`        | `auto` \| `exports` \| `glob` (default: `auto` — exports first, glob fallback). `exports` is strict and fails if package.json exports is missing             |
| `--dist-dir <dir>`          | Dist directory for exports discovery (default: dist)                                                                                                         |
| `--source-dir <dir>`        | Source directory relative to project root (default: src/lib). Repeatable for monorepos; drives the implicit include glob when no `--include` is provided     |
| `--source-root <dir>`       | Source root for module-path stripping (default: single source-dir or longest common prefix; pass `.` for project-relative paths)                             |
| `--on-duplicates <mode>`    | Dispatch on duplicate declaration names: `throw` \| `warn` (default: emit `duplicate_declaration` diagnostic, no dispatch)                                   |
| `--only <pattern>`          | Glob filter applied to module paths in output (repeatable). Full project is still analyzed (re-exports/dependents stay correct); diagnostics aren't filtered |
| `--no-resolve-dependencies` | Disable dependency resolution                                                                                                                                |
| `--pretty`                  | Pretty-print JSON output (default: compact)                                                                                                                  |
| `-q, --quiet`               | Suppress info messages on stderr (warnings and errors still print)                                                                                           |
| `-V, --version`             | Show version number                                                                                                                                          |

Exit codes: 0 (success), 1 (analysis errors), 2 (CLI errors).

See [examples/cli/](examples/cli/README.md) for more usage patterns.

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
import {analyzeFromFiles} from 'svelte-docinfo';

const {modules} = await analyzeFromFiles({projectRoot: process.cwd()});
```

Pass `include` for custom patterns or `discovery: 'glob'` to always use glob.
Use `discovery: 'exports'` for strict mode that throws if `package.json` has no usable `exports` field.
When you already have file contents in memory,
use `analyze` instead of `analyzeFromFiles` to skip file discovery.
For just the discovery step (without running analysis), use
`discoverSourceFiles` from `svelte-docinfo/discovery.js`.

For long-lived consumers (a Vite plugin reacting to file edits, an LSP-style tool),
`createAnalysisSession` returns a persistent handle that reuses parsed ASTs across calls
— see [examples/api/analyze-session.js](examples/api/analyze-session.js).

See [examples/api/](examples/api/README.md) for more patterns
including custom discovery, diagnostics, sessions, and error handling.

Import from `svelte-docinfo` for the common API,
or from subpaths like `svelte-docinfo/typescript-exports.js` for lower-level access.
See the [API docs](https://svelte-docinfo.fuz.dev/docs/api) for the full reference.

## Features

- **Full type resolution**: infers complex types without manual annotations, including generics, imported types, and inferred return types
- **TSDoc/JSDoc parsing**: standard tags (`@param`, `@returns`, `@throws`, `@example`, `@deprecated`, `@see`, `@since`, `@default`) plus `@nodocs`, `@mutates`, and `@module` for file-level comments
- **Svelte 5 component props**: extracts prop types, descriptions, defaults, and bindability via svelte2tsx
- **Svelte 5 snippets**: `kind: 'snippet'` for template snippets (with structured parameters), `acceptsChildren` on components
- **Svelte 5 reactivity runes**: detects `$state`, `$state.raw`, `$derived`, `$derived.by` on variables and class fields (`reactivity` field) — syntactic detection, surfaces wherever the rune pattern appears
- **Class members**: public + protected fields, methods, constructors, getters/setters, generics; private (`private` and `#field`) excluded
- **Enums**: regular and const, with member values and per-member JSDoc
- **Function overloads**: all public overload signatures with per-overload JSDoc
- **Dependency graphs**: tracks imports between modules and computes dependents
- **Re-export tracking**: `alsoExportedFrom` arrays on canonical declarations plus the forward view `ModuleJson.reExports` (so barrels are self-describing), `aliasOf` for renames, `starExports` for `export * from './x'`, and `externalReExports`/`externalStarExports` for direct re-exports from packages — with `resolveExportSurface()` to combine them all into a module's full export surface using ES star semantics
- **Namespace re-exports**: `export * as ns from './x'` synthesized as `kind: 'namespace'`
- **Source locations**: file and line for every declaration
- **Build-tool agnostic**: works with any source: file system, build pipeline, or in-memory
- **Diagnostic collection**: accumulates warnings and errors without halting; `partial: true` flags incomplete declarations

Known gaps:

- context tracking (transitive detection of common patterns seems tractable)
- standalone `namespace Foo {}` declarations and decorators are not yet supported
- Svelte 4 legacy features (slots, events, `$restProps`) are out of scope — Svelte 5 snippets and callback props replace most of them

[Issues](https://github.com/fuzdev/svelte-docinfo/issues) for bugs and
[discussions](https://github.com/fuzdev/svelte-docinfo/discussions) are welcome!

## Documentation

- [svelte-docinfo.fuz.dev](https://svelte-docinfo.fuz.dev/) - docs site with guides, options reference, and API docs
- [examples/vite/](examples/vite/README.md) - Vite plugin with HMR
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

## License

[MIT](LICENSE)
