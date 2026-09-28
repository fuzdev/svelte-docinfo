<script lang="ts">
	import Code from '@fuzdev/fuz_code/Code.svelte';
	import TomeContent from '@fuzdev/fuz_ui/TomeContent.svelte';
	import TomeSection from '@fuzdev/fuz_ui/TomeSection.svelte';
	import TomeSectionHeader from '@fuzdev/fuz_ui/TomeSectionHeader.svelte';
	import DeclarationLink from '@fuzdev/fuz_ui/DeclarationLink.svelte';
	import ModuleLink from '@fuzdev/fuz_ui/ModuleLink.svelte';
	import TomeLink from '@fuzdev/fuz_ui/TomeLink.svelte';
	import { tome_get_by_slug } from '@fuzdev/fuz_ui/tome.ts';

	const LIBRARY_ITEM_NAME = 'vite-plugin';

	const tome = tome_get_by_slug(LIBRARY_ITEM_NAME);
</script>

<svelte:head>
	<title>Vite plugin - svelte-docinfo</title>
</svelte:head>

<TomeContent {tome}>
	<section>
		<p>
			The <ModuleLink module_path="vite.ts">Vite plugin</ModuleLink> is the recommended path for
			SvelteKit and Vite projects. It runs analysis at build time and serves the result as
			<Code lang="ts" inline content="'virtual:svelte-docinfo'" />. In dev it watches your source
			files, plus non-source files they import like <code>internal/</code> modules, and sends HMR
			updates as you edit.
		</p>
	</section>

	<TomeSection>
		<TomeSectionHeader text="Setup" />
		<ol>
			<li>
				<p>Add the plugin to <code>vite.config.ts</code>:</p>
				<Code
					lang="ts"
					content={`import {defineConfig} from 'vite';
import {sveltekit} from '@sveltejs/kit/vite';
import svelteDocinfo from 'svelte-docinfo/vite.js';

export default defineConfig({
  plugins: [sveltekit(), svelteDocinfo()],
});`}
				/>
			</li>
			<li>
				<p>Add TypeScript support in your <code>app.d.ts</code>:</p>
				<Code
					lang="ts"
					content="/// <reference types=&quot;svelte-docinfo/virtual-svelte-docinfo.js&quot; />"
				/>
			</li>
			<li>
				<p>Import the virtual module anywhere in your app:</p>
				<Code
					lang="ts"
					content={`import {modules, diagnostics} from 'virtual:svelte-docinfo';
// or use the default export:
import data from 'virtual:svelte-docinfo';
// data.modules and data.diagnostics are the same as the named exports`}
				/>
				<p>
					The shape is <DeclarationLink name="AnalyzeResultJson" />, the same as the programmatic
					API. See <TomeLink slug="diagnostics" /> for <code>diagnostics</code>.
				</p>
			</li>
		</ol>
		<p>
			If TypeScript reports <code>Cannot find module 'virtual:svelte-docinfo'</code>, check the
			<code>/// &lt;reference&gt;</code> line in <code>app.d.ts</code>.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Options" />
		<p>
			All options are optional; the minimal call discovers files from <code>package.json</code>
			exports, falling back to glob:
		</p>
		<Code lang="ts" content="svelteDocinfo()" />
		<p>Every option, with its default:</p>
		<Code
			lang="ts"
			content={`import svelteDocinfo from 'svelte-docinfo/vite.js';

svelteDocinfo({
  // Project root directory. Default: Vite's resolved config.root.
  projectRoot: process.cwd(),

  // Glob patterns for file discovery. Forces glob mode under discovery: 'auto'.
  // Default: undefined (use exports discovery).
  // Each pattern's static base joins sourceOptions.sourcePaths; a pattern
  // with no base makes the whole project root source and logs an info line.
  include: ['src/**/*.ts', 'src/**/*.svelte'],

  // Exclude globs. An array replaces the default
  // ['**/*.test.ts', '**/*.spec.ts', '**/internal/**']; a callback extends
  // it. Replaces sourceOptions.exclude when both are set. node_modules and
  // dot-directories are always excluded.
  exclude: (defaults) => [...defaults, '**/*.gen.ts'],

  // Discovery strategy: 'auto' | 'exports' | 'glob'. Default: 'auto'.
  // 'auto'    → exports first, glob fallback
  // 'exports' → strict; throws if package.json exports is missing or resolves to no files
  // 'glob'    → skip exports, use glob patterns
  discovery: 'auto',

  // Dist directory for exports discovery. Default: 'dist'.
  distDir: 'dist',

  // Resolve module dependency graph. Default: true.
  resolveDependencies: true,

  // Dispatch on duplicate declaration names across modules.
  // 'throw' | 'warn' | (duplicates, log) => void.
  // Default: undefined (only the duplicate_declaration diagnostic).
  // Set to 'throw' to fail fast on duplicates.
  onDuplicates: undefined,

  // Partial overrides for default source options (SvelteKit src/lib layout).
  // Merged into createSourceOptions(projectRoot, sourceOptions).
  sourceOptions: {sourcePaths: ['src/lib']},

  // HMR debounce in ms. Default: 100.
  hmrDebounceMs: 100,
})`}
		/>
		<p>
			The plugin runs the same pipeline as <DeclarationLink name="analyzeFromFiles" />: discover,
			resolve dependencies, analyze. In dev, imports resolve through Vite's <code>resolveId</code>,
			so Vite aliases apply; in builds, the TypeScript default resolver is used (it honors tsconfig
			<code>paths</code>). <code>hmrDebounceMs</code> only affects the dev watcher.
		</p>
		<p>
			Paths and patterns resolve against <code>projectRoot</code>. Absolute paths and patterns
			inside the root are accepted; anything outside it throws at config time.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="CLI vs Vite plugin" />
		<p>
			The CLI runs <DeclarationLink name="analyzeFromFiles" /> once; use it for CI and one-off
			generation. The plugin keeps a persistent <DeclarationLink name="createAnalysisSession" />, so
			HMR re-analysis reuses parsed ASTs and svelte2tsx output; use it when the analysis feeds your
			app bundle. To drive a session yourself (custom bundler, LSP), see the
			<TomeLink slug="session" /> guide.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="How it works" />
		<p>The plugin hooks into four Vite lifecycle stages:</p>
		<ol>
			<li>
				<strong>configResolved</strong>: validates options, so bad configs (like
				<code>discovery: 'exports'</code> with <code>include</code>, or a path outside the project
				root) fail at startup
			</li>
			<li>
				<strong>buildStart</strong>: creates a session, discovers and ingests the source files, runs
				<code>query</code>, and caches the result
			</li>
			<li>
				<strong>resolveId / load</strong>: serves the cached result as
				<code>virtual:svelte-docinfo</code>, exporting <code>modules</code>,
				<code>diagnostics</code>, and a default <code>{`{modules, diagnostics}`}</code>
			</li>
			<li>
				<strong>configureServer</strong>: watches source files and the non-source files they import
				(e.g. <code>internal/</code> modules), debounces re-analysis, and sends an HMR update only
				when the output changes. Unchanged files aren't re-parsed.
			</li>
		</ol>
	</TomeSection>
</TomeContent>
