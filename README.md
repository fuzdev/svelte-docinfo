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

Given a project with a `tsconfig.json` (at or above the project root) and three files,
`src/lib/maths.ts`:

```ts
/**
 * Add two numbers.
 * @param a - first number
 * @param b - second number
 * @returns the sum
 */
export function add(a: number, b: number): number {
	return a + b;
}
```

`src/lib/calculator.svelte.ts`:

```ts
import { add } from './maths.ts';

/** Reactive calculator state. */
export class CalculatorState {
	/** First operand. */
	a = $state(0);
	/** Second operand. */
	b = $state(0);
	/** Operation mode. */
	mode: 'add' | 'multiply' = $state('add');
	/** The result, kept current. */
	readonly result = $derived(this.mode === 'add' ? add(this.a, this.b) : this.a * this.b);
}
```

and `src/lib/Calculator.svelte`:

```svelte
<!--
	@component
	Calculator component for demonstrating Svelte analysis.
-->
<script lang="ts">
	import type { CalculatorState } from './calculator.svelte.ts';

	let {
		calc,
		disabled = false
	}: {
		/** The calculator's state. */
		calc: CalculatorState;
		/** Disable the calculator. */
		disabled?: boolean;
	} = $props();
</script>

<output>{calc.result}</output>
```

Three ways to use it:

1. [Vite plugin](https://svelte-docinfo.fuz.dev/docs/vite-plugin) - for SvelteKit and Vite projects, a virtual module that stays current in dev:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import svelteDocinfo from 'svelte-docinfo/vite.js';

export default defineConfig({ plugins: [sveltekit(), svelteDocinfo()] });
// then anywhere in your app:
// import {modules} from 'virtual:svelte-docinfo';
```

2. [CLI](https://svelte-docinfo.fuz.dev/docs/cli) - for inspecting a project, writing a JSON file, and shell pipelines:

```bash
npx svelte-docinfo --pretty
```

3. [JS API](https://svelte-docinfo.fuz.dev/docs/js-api) - for scripts and build tools, with `analyze` for contents you already have and `createAnalysisSession` for incremental re-analysis:

```ts
import { analyzeFromFiles } from 'svelte-docinfo';

const { modules } = await analyzeFromFiles({ projectRoot: process.cwd() });
```

By default all three document the source files your `package.json` `exports` point to,
falling back to everything under `src/lib`
(see [source files](https://svelte-docinfo.fuz.dev/docs/source-files)).

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
						{ "name": "calc", "type": "CalculatorState", "description": "The calculator's state." },
						{
							"name": "disabled",
							"type": "boolean",
							"optional": true,
							"description": "Disable the calculator.",
							"defaultValue": "false"
						}
					]
				}
			],
			"dependencies": ["calculator.svelte.ts"]
		},
		{
			"path": "calculator.svelte.ts",
			"declarations": [
				{
					"name": "CalculatorState",
					"kind": "class",
					"docComment": "Reactive calculator state.",
					"sourceLine": 4,
					"members": [
						{
							"name": "a",
							"kind": "variable",
							"docComment": "First operand.",
							"typeSignature": "number",
							"reactivity": "$state"
						},
						{
							"name": "b",
							"kind": "variable",
							"docComment": "Second operand.",
							"typeSignature": "number",
							"reactivity": "$state"
						},
						{
							"name": "mode",
							"kind": "variable",
							"docComment": "Operation mode.",
							"typeSignature": "\"add\" | \"multiply\"",
							"reactivity": "$state",
							"typeInfo": {
								"kind": "union",
								"members": [
									{ "kind": "literal", "value": "add", "text": "\"add\"" },
									{ "kind": "literal", "value": "multiply", "text": "\"multiply\"" }
								]
							}
						},
						{
							"name": "result",
							"kind": "variable",
							"docComment": "The result, kept current.",
							"typeSignature": "number",
							"modifiers": ["readonly"],
							"reactivity": "$derived"
						}
					]
				}
			],
			"dependencies": ["maths.ts"],
			"dependents": ["Calculator.svelte"]
		},
		{
			"path": "maths.ts",
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
			],
			"dependents": ["calculator.svelte.ts"]
		}
	]
}
```

Each import links two modules as `dependencies` and `dependents`, type-only imports included,
and class fields initialized with runes carry their `reactivity`.

The compact form leaves out defaulted fields: empty arrays (like `diagnostics` here) and
`false` flags. To restore them and validate the shape, parse it with `parseAnalyzeResult`
(`parseModuleJson` for one module, `parseDiagnostics` for diagnostics alone):

```ts
import { parseAnalyzeResult } from 'svelte-docinfo';

const { modules, diagnostics } = parseAnalyzeResult(JSON.parse(json));
```

`parseAnalyzeResult` loads the TypeScript compiler, so in browser code use
`parseModuleJson` from `svelte-docinfo/types.js` per module instead.

The parse helpers are the stable entry point. The schemas behind them (`AnalyzeResultJson`,
`ModuleJson`, `DeclarationJson`, …) are exported too, as [fuz_schema](https://schema.fuz.dev/) schemas.

The [extraction demo](https://svelte-docinfo.fuz.dev/demo/extraction) has more examples,
and see the docs for the complete [output format](https://svelte-docinfo.fuz.dev/docs/output-format).
You may also want to browse the [test fixtures](https://github.com/fuzdev/svelte-docinfo/tree/main/src/test/fixtures).

## Features

- **Full type resolution**: generics, imported types, and inferred return types, without manual annotations
- **[TSDoc and JSDoc tags](https://svelte-docinfo.fuz.dev/docs/tags)**, plus the custom `@nodocs` (leave out of docs) and `@mutates`
- **[Structured types](https://svelte-docinfo.fuz.dev/docs/structured-types)**: `typeInfo` trees beside the flat type strings, recovering alias names TypeScript drops (`z.infer`, `v.InferOutput`)
- **Svelte 5 components**: props with types, defaults, and bindability, snippet and callback parameters, generics, children, exported snippets, and runes in any file
- **[Component styling](https://svelte-docinfo.fuz.dev/docs/component-styling)**: the CSS custom properties a component's styles read, plus those documented with `@cssprop`
- **[JS modules](https://svelte-docinfo.fuz.dev/docs/js)** documented like their TS twins, from JSDoc types, `@typedef`s, `@template`s, and `@overload`s
- **[Re-exports](https://svelte-docinfo.fuz.dev/docs/re-exports)** and the import graph between modules
- **[Diagnostics](https://svelte-docinfo.fuz.dev/docs/diagnostics)** collected without halting, for doc problems like misplaced tags and stale `@param`s
- **Build-tool agnostic**: files can come from disk, a build pipeline, or memory

Svelte 4 named slots, slot props, and events, Svelte context, and CommonJS aren't modeled; see the
[limitations](https://svelte-docinfo.fuz.dev/docs/introduction#Limitations).
[Issues](https://github.com/fuzdev/svelte-docinfo/issues) for bugs and
[discussions](https://github.com/fuzdev/svelte-docinfo/discussions) are welcome!

## Documentation

- [svelte-docinfo.fuz.dev](https://svelte-docinfo.fuz.dev/) - docs site with guides, options reference, and API docs
- [extraction demo](https://svelte-docinfo.fuz.dev/demo/extraction) - live examples of source and output
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
