<script lang="ts">
	import Code from '@fuzdev/fuz_code/Code.svelte';
	import TomeContent from '@fuzdev/fuz_ui/TomeContent.svelte';
	import TomeSection from '@fuzdev/fuz_ui/TomeSection.svelte';
	import TomeSectionHeader from '@fuzdev/fuz_ui/TomeSectionHeader.svelte';
	import DeclarationLink from '@fuzdev/fuz_ui/DeclarationLink.svelte';
	import TomeLink from '@fuzdev/fuz_ui/TomeLink.svelte';
	import { tome_get_by_slug } from '@fuzdev/fuz_ui/tome.ts';

	const LIBRARY_ITEM_NAME = 'js-api';

	const tome = tome_get_by_slug(LIBRARY_ITEM_NAME);
</script>

<svelte:head>
	<title>JS API - svelte-docinfo</title>
</svelte:head>

<TomeContent {tome}>
	<section>
		<p>
			Three functions run the analysis, each returning the same
			<DeclarationLink name="AnalyzeResultJson" />. Pick by what your code already has:
		</p>
		<table>
			<thead>
				<tr>
					<th>Function</th>
					<th>Use when</th>
				</tr>
			</thead>
			<tbody>
				<tr>
					<td><DeclarationLink name="analyzeFromFiles" /></td>
					<td>you have a project on disk: it finds, reads, and analyzes the files in one call</td>
				</tr>
				<tr>
					<td><DeclarationLink name="analyze" /></td>
					<td>you already hold the file contents, like a bundler plugin</td>
				</tr>
				<tr>
					<td><DeclarationLink name="createAnalysisSession" /></td>
					<td>you re-analyze the same files as they change, like a watcher or editor tool</td>
				</tr>
			</tbody>
		</table>
		<p>
			The <TomeLink slug="vite-plugin">Vite plugin</TomeLink> runs a session and the
			<TomeLink slug="cli">CLI</TomeLink> runs <code>analyzeFromFiles</code>, so their options map
			onto these.
		</p>
	</section>

	<TomeSection>
		<TomeSectionHeader text="analyzeFromFiles" />
		<Code
			lang="ts"
			content={`import {analyzeFromFiles} from 'svelte-docinfo';

const {modules, diagnostics} = await analyzeFromFiles({
  projectRoot: process.cwd(),
  // the rest are optional:
  // discovery: 'auto' | 'exports' | 'glob',
  // include: ['src/**/*.ts'],
  // exclude: (defaults) => [...defaults, '**/*.gen.ts'],
  // sourceOptions: {sourcePaths: ['src/lib']},
  // tsconfig: 'tsconfig.json', // or false
  // onDuplicates: 'diagnostic' | 'warn' | 'throw',
});`}
		/>
		<p>
			It discovers the files to document from <code>package.json</code> <code>exports</code>,
			falling back to globs under <code>src/lib</code>, as <TomeLink slug="source-files" /> explains
			along with the options that change it. <DeclarationLink name="AnalyzeFromFilesOptions" />
			lists every option.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="analyze" />
		<Code
			lang="ts"
			content={`import {analyze, createSourceOptions} from 'svelte-docinfo';

const {modules, diagnostics} = await analyze({
  sourceFiles: [{id: '/project/src/lib/a.ts', content: '...'}],
  sourceOptions: createSourceOptions('/project'),
});`}
		/>
		<p>
			Each <DeclarationLink name="SourceFileInfo" /> is an absolute <code>id</code> and its
			<code>content</code>. Files outside the source paths (default <code>src/lib</code>) inform
			types but emit no module. TS files you leave out are read from disk for their types, but a
			component you leave out types as <code>any</code>, so pass every component the analyzed code
			imports. <TomeLink slug="build-tools" /> covers pre-resolved dependencies and custom import
			resolution.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="createAnalysisSession" />
		<Code
			lang="ts"
			content={`import {createAnalysisSession, createSourceOptions} from 'svelte-docinfo';

const session = createAnalysisSession({sourceOptions: createSourceOptions(process.cwd())});
await session.setFiles(files); // again on every change; unchanged files are cache hits
const {modules, diagnostics} = session.query();
// ingest diagnostics (like transform_failed) aren't in query(): see allIngestDiagnostics()
session.dispose();`}
		/>
		<p>
			A session keeps parsed files and svelte2tsx output between queries. See the
			<TomeLink slug="session" /> guide.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Results" />
		<p>
			The functions return the result with every default filled in. Serialize it compactly with
			<DeclarationLink name="compactReplacer" />, as the CLI and Vite plugin do, and read compact
			JSON back with <DeclarationLink name="parseAnalyzeResult" />, which restores the defaults and
			validates the shape (see
			<TomeLink slug="output-format" hash="Compact-JSON">compact JSON</TomeLink>):
		</p>
		<Code
			lang="ts"
			content={`import {compactReplacer, parseAnalyzeResult} from 'svelte-docinfo';

const json = JSON.stringify(result, compactReplacer);
const {modules, diagnostics} = parseAnalyzeResult(JSON.parse(json));`}
		/>
		<p>
			Problems in the analyzed code land in <code>diagnostics</code>; bad setup, like a missing
			tsconfig or invalid options, throws. See <TomeLink slug="diagnostics" />.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Imports" />
		<p>
			The <code>svelte-docinfo</code> entry exports the common API and loads the TypeScript
			compiler. Every module is also importable on its own as
			<code>svelte-docinfo/&lt;module&gt;.js</code>, and a few are light enough for a browser
			bundle, for rendering data the analysis produced:
		</p>
		<ul>
			<li>
				<code>svelte-docinfo/types.js</code>: the output schemas and
				<DeclarationLink name="parseModuleJson" />, the browser's stand-in for
				<code>parseAnalyzeResult</code>, which loads the compiler
			</li>
			<li>
				<code>svelte-docinfo/declaration-helpers.js</code>:
				<DeclarationLink name="typeJsonToTokens" />, <DeclarationLink name="generateImport" />,
				<DeclarationLink name="getDisplayName" />
			</li>
			<li>
				<code>svelte-docinfo/diagnostics.js</code>: <DeclarationLink name="parseDiagnostics" /> and
				the read helpers
			</li>
			<li>
				<code>svelte-docinfo/postprocess.js</code>:
				<DeclarationLink name="resolveExportSurface" />
			</li>
		</ul>
		<p>
			The <a href="https://github.com/fuzdev/svelte-docinfo/tree/main/examples/api">API examples</a>
			show more patterns, and the <TomeLink slug="api">API reference</TomeLink> lists everything.
		</p>
	</TomeSection>
</TomeContent>
