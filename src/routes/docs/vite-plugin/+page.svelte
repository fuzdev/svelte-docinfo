<script lang="ts">
	import Code from '@fuzdev/fuz_code/Code.svelte';
	import TomeContent from '@fuzdev/fuz_ui/TomeContent.svelte';
	import TomeSection from '@fuzdev/fuz_ui/TomeSection.svelte';
	import TomeSectionHeader from '@fuzdev/fuz_ui/TomeSectionHeader.svelte';
	import DeclarationLink from '@fuzdev/fuz_ui/DeclarationLink.svelte';
	import ModuleLink from '@fuzdev/fuz_ui/ModuleLink.svelte';
	import TomeLink from '@fuzdev/fuz_ui/TomeLink.svelte';
	import {tome_get_by_slug} from '@fuzdev/fuz_ui/tome.ts';

	const LIBRARY_ITEM_NAME = 'vite-plugin';

	const tome = tome_get_by_slug(LIBRARY_ITEM_NAME);
</script>

<svelte:head>
	<title>Vite plugin - svelte-docinfo</title>
</svelte:head>

<TomeContent {tome}>
	<section>
		<p>
			The <ModuleLink module_path="vite.ts">Vite plugin</ModuleLink> is the recommended path for SvelteKit
			and Vite projects. It runs analysis at build time and serves the result as
			<Code lang="ts" inline content="'virtual:svelte-docinfo'" />; in dev mode it watches source
			files and sends HMR updates as you edit.
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
					Both exports match the programmatic <DeclarationLink name="AnalyzeResultJson" /> shape. See
					<TomeLink slug="diagnostics" /> for what flows through <code>diagnostics</code>.
				</p>
			</li>
		</ol>
		<p>
			If TypeScript reports <code>Cannot find module 'virtual:svelte-docinfo'</code>, ensure the
			<code>/// &lt;reference&gt;</code> line is in your <code>app.d.ts</code>.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Options" />
		<p>
			All options are optional; the minimal call uses defaults (package.json exports discovery, glob
			fallback):
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
  include: ['src/**/*.ts', 'src/**/*.svelte'],

  // Exclude globs. When provided, fully replaces the default
  // ['**/*.test.ts', '**/*.spec.ts'] — re-include those patterns
  // explicitly if you want them filtered.
  exclude: ['**/*.test.ts', '**/*.spec.ts'],

  // Discovery strategy: 'auto' | 'exports' | 'glob'. Default: 'auto'.
  // 'auto'    → exports first, glob fallback
  // 'exports' → strict; throws if package.json exports is missing
  // 'glob'    → skip exports, use glob patterns
  discovery: 'auto',

  // Dist directory for exports discovery. Default: 'dist'.
  distDir: 'dist',

  // Resolve module dependency graph. Default: true.
  resolveDependencies: true,

  // Dispatch on duplicate declaration names across modules.
  // 'throw' | 'warn' | (duplicates, log) => void.
  // Default: undefined — the duplicate_declaration diagnostic still emits,
  // but no extra dispatch fires. Set to 'throw' to fail fast on duplicates.
  onDuplicates: undefined,

  // Partial overrides for default source options (SvelteKit src/lib layout).
  // Merged into createSourceOptions(projectRoot, sourceOptions).
  sourceOptions: {sourcePaths: ['src/lib']},

  // HMR debounce in ms. Default: 100.
  hmrDebounceMs: 100,
})`}
		/>
		<p>
			The plugin runs the same pipeline as <DeclarationLink name="analyzeFromFiles" /> internally: discover
			via <DeclarationLink name="discoverSourceFiles" />, resolve dependencies, then analyze.
			<code>sourceOptions</code> is merged with defaults via
			<DeclarationLink name="createSourceOptions" /> before discovery; <code>hmrDebounceMs</code>
			only affects the dev-mode watcher.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="CLI vs Vite plugin" />
		<p>
			The CLI calls <DeclarationLink name="analyzeFromFiles" /> once, so use it for CI pipelines and one-off
			generation. The plugin owns a persistent <DeclarationLink name="createAnalysisSession" />, so
			HMR re-analyses reuse parsed TypeScript ASTs and svelte2tsx output across cycles. Use it when
			the analysis feeds the SvelteKit/Vite bundle. See the <TomeLink slug="session" /> guide if you're
			driving a session directly (custom bundler, LSP, etc.).
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="How it works" />
		<p>The plugin hooks into four Vite lifecycle stages:</p>
		<ol>
			<li>
				<strong>configResolved</strong>: throws synchronously when
				<code>discovery: 'exports'</code> is combined with <code>include</code>, so contradictory
				configs fail at startup rather than at first analysis
			</li>
			<li>
				<strong>buildStart</strong>: discovers the source set, reads file contents, and runs
				<DeclarationLink name="createAnalysisSession" />'s <code>analyze</code>; caches the
				serialized JSON result
			</li>
			<li>
				<strong>resolveId / load</strong>: serves the cached result as
				<code>virtual:svelte-docinfo</code>, a JavaScript module exporting <code>modules</code>,
				<code>diagnostics</code>, and a default <code>{`{modules, diagnostics}`}</code>
			</li>
			<li>
				<strong>configureServer</strong>: watches source directories for changes, debounces
				re-analysis, and sends HMR updates only when the output actually changes. The session diffs
				incoming files by content equality, so unchanged files skip re-parsing entirely.
			</li>
		</ol>
	</TomeSection>
</TomeContent>
