<script lang="ts">
	import Code from '@fuzdev/fuz_code/Code.svelte';
	import TomeContent from '@fuzdev/fuz_ui/TomeContent.svelte';
	import TomeSection from '@fuzdev/fuz_ui/TomeSection.svelte';
	import TomeSectionHeader from '@fuzdev/fuz_ui/TomeSectionHeader.svelte';
	import { tome_get_by_slug } from '@fuzdev/fuz_ui/tome.ts';
	import TomeLink from '@fuzdev/fuz_ui/TomeLink.svelte';
	import DeclarationLink from '@fuzdev/fuz_ui/DeclarationLink.svelte';

	const LIBRARY_ITEM_NAME = 'introduction';

	const tome = tome_get_by_slug(LIBRARY_ITEM_NAME);
</script>

<svelte:head>
	<title>introduction - svelte-docinfo</title>
</svelte:head>

<TomeContent {tome}>
	<section>
		<p>
			svelte-docinfo extracts JSON describing the exports of TypeScript and Svelte modules for
			open-ended use cases like docs, code search, and dev tools. It uses the TypeScript compiler
			API and
			<a href="https://github.com/sveltejs/language-tools/tree/master/packages/svelte2tsx">
				svelte2tsx
			</a>
			to resolve types, track exports+imports, and extract semantic details. The
			<a href="https://www.npmjs.com/package/svelte-docinfo">npm package</a> has a Vite plugin, CLI,
			and programmatic API.
		</p>
		<p>
			svelte-docinfo is largely inspired by
			<a href="https://github.com/carbon-design-system/sveld">sveld</a>, but uses the TypeScript
			compiler API instead of AST-only inspection, and also analyzes TypeScript modules. See the
			<a href="#Compared-to-sveld">comparison</a> below.
		</p>
		<p>
			The library is mostly complete for Svelte 5 and used in production websites, but you may find
			gaps and flaws -- please open issues for bugs, and
			<a href="https://github.com/fuzdev/svelte-docinfo/discussions">discussions</a> for everything
			else!
		</p>
		<p>
			Dependencies are minimal and the tool's scope is limited to data, not presentation. These docs
			were made using the data produced by svelte-docinfo, like the <TomeLink slug="architecture" />
			and <TomeLink slug="api">API reference</TomeLink>, with
			<a href="https://ui.fuz.dev/">fuz_ui</a> components.
		</p>
		<p class="panel p_md">
			<strong>AI disclosure:</strong> the code and docs beyond the intro were mostly written by
			Claude Code with uneven human guidance. The first release took 5 months of intermittent work
			and ~500 manual commits to
			<a href="https://github.com/fuzdev/fuz_ui/pull/107">
				extract its initial implementation from fuz_ui
			</a>, which was more limited, lacking the fancy TS compiler usage, and grew slowly over years
			without AI assistance.
		</p>
		<TomeSection>
			<TomeSectionHeader text="Install" />
			<p>
				Published as <code>svelte-docinfo</code> to
				<a href="https://www.npmjs.com/package/svelte-docinfo">npm</a>:
			</p>
			<code class="panel p_md mb_lg display:block">npm i -D svelte-docinfo</code>
		</TomeSection>
		<TomeSection>
			<TomeSectionHeader text="Usage" />
			<p>There are several ways to get the JSON, from most opinionated to most flexible.</p>
			<p>
				For SvelteKit and Vite projects, the <TomeLink slug="vite-plugin">Vite plugin</TomeLink> is
				the recommended path. It runs the analysis at build time and serves the result as a virtual
				module with HMR:
			</p>
			<Code lang="ts" content={`import {modules} from 'virtual:svelte-docinfo';`} />
			<p>
				Run the <TomeLink slug="cli">CLI</TomeLink> to inspect a project from the command line:
			</p>
			<Code
				lang="bash"
				content={`# Analyze the current project and print JSON to stdout
npx svelte-docinfo

# Analyze a specific directory and write to a file
npx svelte-docinfo ./packages/my-lib -o docs/library.json`}
			/>
			<p>
				For standalone use or custom build tools, two functions cover most cases.
				<DeclarationLink name="analyzeFromFiles" /> discovers files for you:
			</p>
			<Code
				lang="ts"
				content={`import {analyzeFromFiles} from 'svelte-docinfo';

const {modules, diagnostics} = await analyzeFromFiles({
  projectRoot: process.cwd(),
});`}
			/>
			<p>
				If your build tool already has file contents in memory, <DeclarationLink name="analyze" />
				skips discovery. See the <TomeLink slug="build-tools" /> guide:
			</p>
			<Code
				lang="ts"
				content={`import {analyze, createSourceOptions} from 'svelte-docinfo';

const {modules} = await analyze({
  // files outside sourcePaths (default src/lib) feed the checker but emit no module
  sourceFiles: [{id: '/project/src/lib/file.ts', content: '...'}],
  sourceOptions: createSourceOptions('/project'),
});`}
			/>
			<p>
				For long-lived consumers that re-analyze the same source set (Vite plugin, LSP-style tools),
				<DeclarationLink name="createAnalysisSession" /> returns a persistent handle that reuses
				parsed ASTs and svelte2tsx output across calls. See the <TomeLink slug="session" /> guide.
			</p>
			<p>
				See the <TomeLink slug="api">API reference</TomeLink> for all exported functions and types.
			</p>
		</TomeSection>
		<TomeSection>
			<TomeSectionHeader text="Not supported" />
			<p>
				Standalone <code>namespace Foo {`{}`}</code> declarations document as a bare variable with
				no members (namespace re-exports <em>are</em> supported). Decorators aren't modeled.
			</p>
			<p>
				Svelte 4 features like slots are not supported. Legacy <code>export let</code> props aren't
				extracted, but a <code>legacy_props</code> warning names them. Svelte context usage isn't
				captured either.
			</p>
		</TomeSection>
		<TomeSection>
			<TomeSectionHeader text="Key features" />
			<ul>
				<li>
					<strong>full type resolution</strong>: infers complex types without manual annotations,
					including generics, imported types, and inferred return types, with source locations for
					every declaration
				</li>
				<li>
					<strong><TomeLink slug="tags">TSDoc/JSDoc parsing</TomeLink></strong>: extracts standard
					tags (<code>@param</code>, <code>@returns</code>, <code>@example</code>,
					<code>@deprecated</code>, etc.) plus <code>@nodocs</code> to exclude from docs,
					<code>@internal</code> kept as an <code>internalMessage</code> marker, and
					<code>@mutates</code> to flag side effects
				</li>
				<li>
					<strong>structured types</strong>: <code>typeInfo</code> trees beside the flat type
					strings, with union members, type arguments, tuple elements, and alias names recovered
					where TypeScript drops them (<code>z.infer</code> and friends); see the
					<TomeLink slug="output-format">output format</TomeLink>
				</li>
				<li>
					<strong>merged value+type symbols</strong>: a schema/type pair
					(<code>{`const Foo = z.strictObject({...})`}</code> +
					<code>{`type Foo = z.infer<typeof Foo>`}</code>) documents the type with full structure,
					marked <code>mergedValue</code> since the name is also a runtime value
				</li>
				<li>
					<strong>Svelte 5 components</strong>: analyzes components via svelte2tsx, extracting prop
					types, defaults, bindability, snippet parameters, children detection, and exported
					template snippets, including JS components (props from the JSDoc <code>@type</code> on
					<code>$props()</code>)
				</li>
				<li>
					<strong>Svelte 5 reactivity runes</strong>: detects <code>$state</code>,
					<code>$state.raw</code>, <code>$derived</code>, and <code>$derived.by</code> on variables
					and class fields via the <code>reactivity</code> field, in any analyzed file
				</li>
				<li>
					<strong>re-export tracking</strong>: <code>alsoExportedFrom</code> arrays with the forward
					view on <code>ModuleJson.reExports</code>, <code>aliasOf</code> for renames, default-slot
					entries named <code>"default"</code>, <code>export * from</code> patterns, direct external
					re-exports, and <DeclarationLink name="resolveExportSurface" /> to combine them all with
					ES star semantics
				</li>
				<li>
					<strong>dependency graphs</strong>: tracks imports between modules and computes dependents
				</li>
				<li>
					<strong>function overloads</strong>: captures all public overload signatures with
					per-overload JSDoc
				</li>
				<li>
					<strong>build-tool agnostic</strong>: files can come from disk, a build pipeline, or
					memory
				</li>
				<li>
					<strong><TomeLink slug="diagnostics">diagnostic collection</TomeLink></strong>:
					accumulates warnings and errors without halting, so you can report problems in batch
				</li>
			</ul>
		</TomeSection>
		<TomeSection>
			<TomeSectionHeader text="Compared to sveld" />
			<p>
				<a href="https://github.com/carbon-design-system/sveld"><code>sveld</code></a> is a Svelte
				component documentation generator that walks the AST and infers types from JSDoc annotations
				and literal values. svelte-docinfo instead uses the TypeScript compiler API (via svelte2tsx)
				as its source of truth, so it resolves imported types, generics, and complex inferred types
				without requiring <code>@type</code> annotations. It also analyzes TypeScript modules, not
				just <code>.svelte</code> files.
			</p>
			<p>
				svelte-docinfo additionally tracks re-exports across modules, computes dependency graphs,
				and records source locations. It doesn't support Svelte 4 features like slots and dispatched
				events (Svelte 5 replaces them with snippets and callback props) or the context API.
			</p>
		</TomeSection>
		<TomeSection>
			<TomeSectionHeader text="Example output" />
			<p>
				See the <TomeLink slug="output-format" /> reference for example JSON output.
			</p>
		</TomeSection>
	</section>
</TomeContent>
