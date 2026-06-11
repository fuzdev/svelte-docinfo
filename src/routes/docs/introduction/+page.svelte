<script lang="ts">
	import Code from '@fuzdev/fuz_code/Code.svelte';
	import TomeContent from '@fuzdev/fuz_ui/TomeContent.svelte';
	import TomeSection from '@fuzdev/fuz_ui/TomeSection.svelte';
	import TomeSectionHeader from '@fuzdev/fuz_ui/TomeSectionHeader.svelte';
	import {tome_get_by_slug} from '@fuzdev/fuz_ui/tome.js';
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
			open-ended use cases like docs, code search, and dev tools. It uses
			<a href="https://github.com/sveltejs/language-tools/tree/master/packages/svelte2tsx"
				>svelte2tsx</a
			>
			and the TypeScript compiler API to resolve types, track exports+imports, and extract semantic details.
			The
			<a href="https://www.npmjs.com/package/svelte-docinfo">npm package</a> has a Vite plugin, CLI, and
			programmatic API.
		</p>
		<p>
			svelte-docinfo is largely inspired by <a href="https://github.com/carbon-design-system/sveld"
				>sveld</a
			>, but instead of AST-only inspection it uses the TypeScript compiler API for richer
			information, and also analyzes TypeScript modules. See the
			<a href="#Compared-to-sveld">comparison</a> below.
		</p>
		<p>
			The library is mostly complete for Svelte 5 and used in production websites, but you may find
			gaps and flaws -- please open issues for bugs, and <a
				href="https://github.com/fuzdev/svelte-docinfo/discussions">discussions</a
			>
			for everything else!
		</p>
		<p>
			Dependencies are minimal and the tool's scope is limited to data, not presentation. These docs
			were made using the data produced by svelte-docinfo, like the <TomeLink slug="architecture" /> and
			<TomeLink slug="api">API reference</TomeLink>, with <a href="https://ui.fuz.dev/">fuz_ui</a> components.
		</p>
		<p class="panel p_md">
			<strong>AI disclosure:</strong> the code and docs beyond the intro were mostly written by Claude
			Code with uneven human guidance. The first release took 5 months of intermittent work and ~500 manual
			commits.
		</p>
		<TomeSection>
			<TomeSectionHeader text="Install" />
			<p>
				Published as <code>svelte-docinfo</code> to
				<a href="https://www.npmjs.com/package/svelte-docinfo">npm</a>:
			</p>
			<code class="panel p_md mb_lg display:block">npm install svelte-docinfo -D</code>
		</TomeSection>
		<TomeSection>
			<TomeSectionHeader text="Usage" />
			<p>
				The tool's main function is outputting JSON, and there are several integration paths, in
				rough order from most opinionated to most flexible:
			</p>
			<p>
				For SvelteKit and Vite projects, the
				<TomeLink slug="vite-plugin">Vite plugin</TomeLink> is the recommended path. It runs the analysis
				at build time and serves the result as a virtual module with HMR:
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
				<DeclarationLink name="analyzeFromFiles" /> handles file discovery automatically:
			</p>
			<Code
				lang="ts"
				content={`import {analyzeFromFiles} from 'svelte-docinfo';

const {modules, diagnostics} = await analyzeFromFiles({
  projectRoot: process.cwd(),
});`}
			/>
			<p>
				If your build tool already has file contents in memory, use <DeclarationLink
					name="analyze"
				/> directly to skip file discovery. See the <TomeLink slug="build-tools" /> guide for the full
				integration surface:
			</p>
			<Code
				lang="ts"
				content={`import {analyze, createSourceOptions} from 'svelte-docinfo';

const {modules} = await analyze({
  sourceFiles: [{id: '/path/to/file.ts', content: '...'}],
  sourceOptions: createSourceOptions('/project'),
});`}
			/>
			<p>
				For long-lived consumers (Vite plugin, LSP-style tools) that re-analyze the same source set
				repeatedly, <DeclarationLink name="createAnalysisSession" /> returns a persistent handle backed
				by a TypeScript <code>LanguageService</code>. Parsed ASTs and svelte2tsx output are reused
				across calls. The one-shot <code>analyze</code> and <code>analyzeFromFiles</code> are thin
				wrappers over single-use sessions. See the <TomeLink slug="session" /> guide for the full incremental
				API.
			</p>
			<p>
				See the <TomeLink slug="api">API reference</TomeLink> for all exported functions and types.
			</p>
		</TomeSection>
		<TomeSection>
			<TomeSectionHeader text="Not supported" />
			<p>
				A few constructs are silently skipped: standalone <code>namespace Foo {`{}`}</code>
				declarations (namespace re-exports <em>are</em> supported), decorators, and per-parameter
				doc fields beyond <code>@param</code> descriptions. <code>ParameterJson</code> deliberately
				doesn't carry <code>@example</code>/<code>@deprecated</code>/<code>@since</code>/<code
					>@see</code
				>/<code>@throws</code>. Per the TSDoc spec, those tags are scoped to the function symbol and
				live on the parent declaration.
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
					<code>@deprecated</code>, etc.) plus <code>@nodocs</code> to exclude from docs and
					<code>@mutates</code> to flag side effects
				</li>
				<li>
					<strong>Svelte 5 components</strong>: analyzes components via svelte2tsx, extracting prop
					types, defaults, bindability, snippet parameters, children detection, and exported
					template snippets
				</li>
				<li>
					<strong>Svelte 5 reactivity runes</strong>: detects <code>$state</code>,
					<code>$state.raw</code>, <code>$derived</code>, and <code>$derived.by</code> on variables
					and class fields and exposes them via the <code>reactivity</code> field. Detection is syntactic,
					so the same patterns can be captured in any analyzed file
				</li>
				<li>
					<strong>re-export tracking</strong>: <code>alsoExportedFrom</code> arrays with the forward
					view on <code>ModuleJson.reExports</code>, <code>aliasOf</code> for renames, default-slot
					entries named <code>"default"</code>, <code>export * from</code> patterns, direct external
					re-exports, and <code>resolveExportSurface()</code> to combine them all with ES star semantics
				</li>
				<li>
					<strong>dependency graphs</strong>: tracks imports between modules and computes dependents
				</li>
				<li>
					<strong>function overloads</strong>: captures all public overload signatures with
					per-overload JSDoc
				</li>
				<li>
					<strong>build-tool agnostic</strong>: works with any source: file system, build pipeline,
					or in-memory
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
				svelte-docinfo is largely inspired by
				<a href="https://github.com/carbon-design-system/sveld"><code>sveld</code></a>, a Svelte
				component documentation generator that walks the AST and infers types from JSDoc annotations
				and literal values. svelte-docinfo instead uses the TypeScript compiler API (via svelte2tsx)
				as its source of truth, so it resolves imported types, generics, and complex inferred types
				without requiring <code>@type</code> annotations. It also analyzes TypeScript modules, not
				just <code>.svelte</code> files.
			</p>
			<p>
				svelte-docinfo additionally tracks re-exports across modules, computes dependency graphs,
				and records source locations. It does not currently support Svelte 4 features like legacy
				slots, dispatched events, or the context API. Svelte 5 replaces most of these with snippets
				and callback props.
			</p>
		</TomeSection>
	</section>
</TomeContent>
