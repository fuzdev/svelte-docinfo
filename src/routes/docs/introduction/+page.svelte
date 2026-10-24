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
			to resolve types, track exports+imports, and extract semantic details.
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
			<code class="panel p_md mb_lg display:block">npm i -D svelte-docinfo</code>
			<p>
				Peer dependencies: <code>svelte</code> 5+, <code>svelte2tsx</code>, and
				<code>typescript</code> 5.9+ or 6, plus <code>vite</code> 6+ for the Vite plugin.
			</p>
		</TomeSection>
		<TomeSection>
			<TomeSectionHeader text="Three ways to use it" />
			<p>
				All three run the same analysis and produce the same data,
				<DeclarationLink name="AnalyzeResultJson" />: <code>{`{modules, diagnostics}`}</code>.
			</p>
			<TomeSection>
				<TomeSectionHeader text="Vite plugin" />
				<p>
					For SvelteKit and Vite projects, the <TomeLink slug="vite-plugin">Vite plugin</TomeLink>
					analyzes at build time and serves the result as a virtual module that stays current in
					dev:
				</p>
				<Code
					lang="ts"
					content={`// vite.config.ts
import {defineConfig} from 'vite';
import {sveltekit} from '@sveltejs/kit/vite';
import svelteDocinfo from 'svelte-docinfo/vite.js';

export default defineConfig({plugins: [sveltekit(), svelteDocinfo()]});

// anywhere in your app
import {modules} from 'virtual:svelte-docinfo';`}
				/>
			</TomeSection>
			<TomeSection>
				<TomeSectionHeader text="CLI" />
				<p>
					The <TomeLink slug="cli">CLI</TomeLink> inspects a project, writes a JSON file, or feeds a
					shell pipeline:
				</p>
				<Code lang="bash" content="npx svelte-docinfo --pretty -o library.json" />
			</TomeSection>
			<TomeSection>
				<TomeSectionHeader text="JS API" />
				<p>
					The <TomeLink slug="js-api">JS API</TomeLink> serves scripts and build tools:
					<DeclarationLink name="analyzeFromFiles" /> finds the files itself,
					<DeclarationLink name="analyze" /> takes contents you already have, and
					<DeclarationLink name="createAnalysisSession" /> re-analyzes incrementally.
				</p>
				<Code
					lang="ts"
					content={`import {analyzeFromFiles} from 'svelte-docinfo';

const {modules, diagnostics} = await analyzeFromFiles({projectRoot: process.cwd()});`}
				/>
			</TomeSection>
			<p>
				By default all three document the source files your <code>package.json</code>
				<code>exports</code> point to, falling back to everything under <code>src/lib</code>; see
				<TomeLink slug="source-files" />. The <TomeLink slug="output-format" /> reference shows the
				JSON.
			</p>
		</TomeSection>
		<TomeSection>
			<TomeSectionHeader text="What it extracts" />
			<ul>
				<li>
					<strong>every export</strong> of every documented module, with the checker's types
					(generics, imported and inferred types, no annotations needed), docs, and source lines
				</li>
				<li>
					<strong><TomeLink slug="tags">TSDoc and JSDoc tags</TomeLink></strong>, plus
					<code>@nodocs</code> to leave a declaration out and <code>@mutates</code> for side effects
				</li>
				<li>
					<strong><TomeLink slug="structured-types">structured types</TomeLink></strong>:
					<code>typeInfo</code> trees beside the flat type strings, recovering alias names
					TypeScript drops (<code>z.infer</code>, <code>v.InferOutput</code>)
				</li>
				<li>
					<strong>Svelte 5 components</strong>: props with types, defaults, and bindability, snippet
					and callback parameters, generics, children, exported snippets, and runes
					(<code>$state</code>, <code>$derived</code>) in any file
				</li>
				<li>
					<strong><TomeLink slug="component-styling">component styling</TomeLink></strong>: the CSS
					custom properties a component's styles read, plus those documented with
					<code>@cssprop</code>
				</li>
				<li>
					<strong><TomeLink slug="js">JS modules</TomeLink></strong> documented like their TS twins,
					from JSDoc types, <code>@typedef</code>s, <code>@template</code>s, and
					<code>@overload</code>s
				</li>
				<li>
					<strong><TomeLink slug="re-exports">re-exports</TomeLink></strong> and the import graph
					between modules
				</li>
				<li>
					<strong><TomeLink slug="diagnostics">diagnostics</TomeLink></strong> collected without
					halting, for doc problems like misplaced tags and stale <code>@param</code>s
				</li>
			</ul>
		</TomeSection>
		<TomeSection>
			<TomeSectionHeader text="Limitations" />
			<ul>
				<li>
					Svelte 4 slots and events aren't modeled, nor context (<code>setContext</code>); a
					<a href="https://github.com/fuzdev/svelte-docinfo/discussions">request</a> would bump
					context's priority. Legacy <code>export let</code> components document their props.
				</li>
				<li>
					Standalone <code>namespace Foo {`{}`}</code> declarations document as a bare variable
					(<code>export * as ns</code> works), and decorators aren't modeled.
				</li>
				<li>
					CommonJS isn't modeled (see <TomeLink slug="js" hash="CommonJS">CommonJS</TomeLink>).
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
				in TypeScript components without <code>@type</code> annotations. It also analyzes TypeScript
				modules, not just <code>.svelte</code> files, tracks re-exports across modules, computes
				dependency graphs, and records source locations.
			</p>
		</TomeSection>
	</section>
</TomeContent>
