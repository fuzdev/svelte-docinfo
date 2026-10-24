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
			files, plus the other files they import like <code>internal/</code> modules, and reloads the
			page when an edit changes the result.
		</p>
		<p>
			The plugin keeps a persistent <DeclarationLink name="createAnalysisSession" />, so dev
			re-analysis reuses parsed ASTs and svelte2tsx output. To write the data to a file instead, use
			the <TomeLink slug="cli">CLI</TomeLink>.
		</p>
	</section>

	<TomeSection>
		<TomeSectionHeader text="Setup" />
		<p>Requires Vite 6 or later.</p>
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
					The data is <DeclarationLink name="AnalyzeResultJson" /> in its wire form
					(<DeclarationLink name="AnalyzeResultJsonWire" />). <code>modules</code> and
					<code>diagnostics</code> are always arrays, but entries in <code>modules</code> omit empty
					arrays and <code>false</code> flags. Treat absent as empty, or restore the defaults per
					module with <DeclarationLink name="parseModuleJson" /> from
					<code>svelte-docinfo/types.js</code>, which is light enough for the browser (see
					<TomeLink slug="output-format" hash="Compact-JSON">compact JSON</TomeLink>). See
					<TomeLink slug="diagnostics" /> for <code>diagnostics</code>.
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
		<p>Every option, with its default in the comment above it:</p>
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
  // ['**/*.{test,spec}.{ts,mts,tsx,js,mjs,jsx}', '**/internal/**']; a callback extends
  // it. Replaces sourceOptions.exclude when both are set. node_modules and
  // dot-directories below a source path are never source.
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

  // Partial overrides for default source options (SvelteKit src/lib layout).
  // Merged into createSourceOptions(projectRoot, sourceOptions).
  sourceOptions: {sourcePaths: ['src/lib']},

  // dev re-analysis debounce in ms. Default: 100.
  hmrDebounceMs: 100,

  // Opt-in check that names are unique across modules, for packages with a
  // flat export namespace. Default: undefined (off).
  // 'diagnostic' → emit duplicate_declaration diagnostics
  // 'warn'       → also log them
  // 'throw'      → also fail the build
  onDuplicates: undefined,

  // tsconfig path relative to projectRoot (searched upward from it), or false
  // to analyze without one. Default: 'tsconfig.json'.
  tsconfig: 'tsconfig.json',

  // Compiler options merged over the tsconfig's. Default: none.
  compilerOptions: undefined,

  // The program's root files, in place of the tsconfig's: a list, or a
  // function over the tsconfig's roots. Default: the tsconfig's roots.
  // See the source files guide for the declarationFileRoots preset and its tradeoff.
  rootFileNames: undefined,
})`}
		/>
		<p>
			The plugin runs the same pipeline as <DeclarationLink name="analyzeFromFiles" />: discover,
			resolve dependencies, analyze. In dev, imports resolve through Vite's <code>resolveId</code>,
			so Vite aliases apply; in builds, the TypeScript default resolver is used (it honors tsconfig
			<code>paths</code>). <code>hmrDebounceMs</code> only affects the dev watcher.
		</p>
		<p>
			<TomeLink slug="source-files" /> covers how <code>discovery</code>, <code>include</code>,
			<code>exclude</code>, <code>sourceOptions</code>, and the tsconfig options decide what's
			documented.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Dev behavior" />
		<p>
			Options are validated when Vite resolves its config, so a bad one (like
			<code>discovery: 'exports'</code> with <code>include</code>, or a path outside the project
			root) fails at startup.
		</p>
		<p>
			In dev the plugin watches the source files and the files they import, debounces re-analysis by
			<code>hmrDebounceMs</code>, and re-parses only what changed. Only the files discovery selects
			emit modules, as in a build: an edit elsewhere refreshes the analysis without adding a module,
			and a newly created file is checked against discovery again.
		</p>
		<p>
			Any change to the output reloads the page, even one that only shifts a declaration's source
			line, instead of letting Svelte HMR update components in place. Importers build state from the
			data (like a layout building a library from <code>modules</code>), so re-running the module
			alone would leave them stale.
		</p>
	</TomeSection>
</TomeContent>
