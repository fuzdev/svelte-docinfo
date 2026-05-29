<script lang="ts">
	import Code from '@fuzdev/fuz_code/Code.svelte';
	import TomeContent from '@fuzdev/fuz_ui/TomeContent.svelte';
	import TomeSection from '@fuzdev/fuz_ui/TomeSection.svelte';
	import TomeSectionHeader from '@fuzdev/fuz_ui/TomeSectionHeader.svelte';
	import DeclarationLink from '@fuzdev/fuz_ui/DeclarationLink.svelte';
	import ModuleLink from '@fuzdev/fuz_ui/ModuleLink.svelte';
	import TomeLink from '@fuzdev/fuz_ui/TomeLink.svelte';
	import {tome_get_by_slug} from '@fuzdev/fuz_ui/tome.js';

	const LIBRARY_ITEM_NAME = 'session';

	const tome = tome_get_by_slug(LIBRARY_ITEM_NAME);
</script>

<svelte:head>
	<title>session - svelte-docinfo</title>
</svelte:head>

<TomeContent {tome}>
	<section>
		<p>
			<DeclarationLink name="createAnalysisSession" /> returns a persistent analysis handle backed by
			a TypeScript <code>LanguageService</code>. Use it when the same source set is re-analyzed
			repeatedly (Vite plugin, LSP-style tools) so parsed ASTs, svelte2tsx output, and the
			dependency graph are reused across cycles. The one-shot
			<DeclarationLink name="analyze" /> and
			<DeclarationLink name="analyzeFromFiles" /> are thin wrappers over single-use sessions.
		</p>
	</section>

	<TomeSection>
		<TomeSectionHeader text="Construction" />
		<Code
			lang="ts"
			content={`import {createAnalysisSession, createSourceOptions} from 'svelte-docinfo';

const session = createAnalysisSession({
  sourceOptions: createSourceOptions(process.cwd()),
  // Optional: session-default ImportResolver. Lazily constructed
  // (TS + tsconfig) on first use when omitted, unless every batch
  // arrives fully pre-resolved.
  // resolveImport: myResolver,
  // Optional: logger for session-level messages.
  // log: console,
});`}
		/>
		<p>
			<DeclarationLink name="AnalysisSessionOptions" /> requires a fully-constructed
			<code>ModuleSourceOptions</code>. Use <DeclarationLink name="createSourceOptions" /> to merge with
			<DeclarationLink name="DEFAULT_SOURCE_OPTIONS" />. The session re-runs
			<code>normalizeSourceOptions</code> (idempotent) but does not apply any further defaults.
		</p>
		<p>
			<code>tsconfig</code> and <code>compilerOptions</code> flow to both the underlying
			<code>LanguageService</code> and the lazy default <DeclarationLink name="ImportResolver" />.
			User-supplied <code>compilerOptions</code> merge over the parsed tsconfig per key, but the tsconfig
			file is still required.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Lifecycle" />
		<p>
			The session exposes a small incremental surface — add, update, remove — for owning the source
			set:
		</p>
		<table>
			<thead>
				<tr>
					<th class="white-space:nowrap">Method</th>
					<th>Purpose</th>
				</tr>
			</thead>
			<tbody>
				<tr>
					<td class="white-space:nowrap"><code>setFile(file, opts?)</code></td>
					<td>
						Ingest one file's content. Idempotent on cache hit. Returns
						<DeclarationLink name="SetFileResult" />
					</td>
				</tr>
				<tr>
					<td class="white-space:nowrap"><code>setFiles(files, opts?)</code></td>
					<td>
						Ingest a batch. Additive, never removes. Returns
						<DeclarationLink name="SetFilesResult" /> with both aggregate and per-file views
					</td>
				</tr>
				<tr>
					<td class="white-space:nowrap"><code>deleteFile(id)</code></td>
					<td>Drop a file from the session and evict it from the LS</td>
				</tr>
				<tr>
					<td class="white-space:nowrap"><code>has(id)</code></td>
					<td>Whether the given absolute path is currently owned</td>
				</tr>
				<tr>
					<td class="white-space:nowrap"><code>list()</code></td>
					<td>Snapshot of owned file IDs (insertion order)</td>
				</tr>
				<tr>
					<td class="white-space:nowrap"><code>query(opts?)</code></td>
					<td>
						Run a two-phase analysis pass against the current owned set. Returns
						<DeclarationLink name="AnalyzeResultJson" />
					</td>
				</tr>
				<tr>
					<td class="white-space:nowrap"><code>allIngestDiagnostics()</code></td>
					<td>Cumulative ingest-time diagnostics across every owned entry</td>
				</tr>
				<tr>
					<td class="white-space:nowrap"><code>dispose()</code></td>
					<td>Release LS resources and clear the owned set. Session must not be used after</td>
				</tr>
			</tbody>
		</table>
		<p>
			<strong>Concurrency.</strong> The session is not safe across overlapping calls, so serialize
			externally. The LS underneath is sync, but the resolver phase awaits I/O for async resolvers
			(Vite/Rollup), so <code>setFile</code> / <code>setFiles</code> cross await boundaries.
			<code>query</code> is sync and reads the current owned set; await any pending ingest first.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Cache-hit semantics" />
		<p>
			Each owned entry is all-or-nothing per cache decision: either every cached artifact for that
			file is reused, or every artifact is recomputed. Whether a re-ingest cache-hits is
			mode-discriminated:
		</p>
		<ul>
			<li>
				<strong>lex+resolve</strong> (default): cache key is
				<code>(content, resolverIdentity)</code>. Match requires byte-for-byte content equality AND
				identity equality on the
				<DeclarationLink name="ImportResolver" />.
			</li>
			<li>
				<strong>pre-resolved</strong> (caller supplies <code>SourceFileInfo.dependencies</code>):
				cache key is <code>(content, dependencies-element-wise-equal)</code>. A fresh array with
				identical contents cache-hits (so <code>[...filer.deps.keys()]</code>-per-call works); any
				length, element, or order difference cache-misses.
			</li>
		</ul>
		<p>
			A mode flip (an entry previously ingested as lex+resolve now arrives with
			<code>dependencies</code>, or vice versa) always cache-misses and rewrites the entry.
		</p>
		<p>
			On a cache hit, <code>SetFileResult.changed</code> is <code>false</code> and the cached ingest diagnostics
			are returned with no work run. On a miss, the entry is rewritten. The LS push happens on miss for
			TS/JS files and for Svelte files with a successful svelte2tsx virtual; CSS/JSON and transform-failed
			Svelte rewrite the entry without touching the LS.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="ImportResolver and identity" />
		<p>
			<DeclarationLink name="ImportResolver" /> is a token pair:
			<code>{`{resolve, identity}`}</code>. <code>identity</code> is a stable opaque token (string or
			symbol) that keys the resolve cache alongside content.
		</p>
		<Code
			lang="ts"
			content={`import type {ImportResolver} from 'svelte-docinfo';

const myResolver: ImportResolver = {
  identity: 'vite-plugin-container',
  resolve: (specifier, fromFile) => {
    // return absolute path, or null for externals
    return null;
  },
};`}
		/>
		<p>
			Identity is required (not optional). The naive alternative, keying on the function reference,
			would silently destroy cache reuse when callers wrap the resolver in a fresh closure per call
			(a common Vite/Rollup pattern). Opaque tokens lift the responsibility to the caller, where it
			can be done correctly: reuse the same string/symbol across calls if the resolution semantics
			haven't changed.
		</p>
		<p>
			When neither <code>AnalysisSessionOptions.resolveImport</code> nor a per-call
			<DeclarationLink name="SetFileOptions" />.<code>resolveImport</code> is supplied, the session
			lazily constructs a TS + tsconfig default with a fresh symbol identity on first use. That
			laziness matters: if every file in every batch arrives fully pre-resolved (<code
				>SourceFileInfo.dependencies</code
			>
			populated), the default is never built and
			<code>loadTsconfig</code> is never called, saving a multi-second
			<code>ts.createProgram</code> on cold start.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Trust mode for pre-resolved dependencies" />
		<p>
			When a caller supplies <code>SourceFileInfo.dependencies</code>, the session accepts the array
			unconditionally and skips its own resolve pass. A buggy caller-side resolver skews
			<code>ModuleJson.dependencies</code> / <code>dependents</code> with no warning. The
			lex+resolve fallback is always grounded in syntactic imports, so switch to it if you don't
			control the dependency source. See
			<TomeLink slug="build-tools">build-tool integration</TomeLink> for the full trust contract and type-only-edge
			policy.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Diagnostics: ingest-time vs query-time" />
		<p>Diagnostic kinds split into two categories with different lifecycles:</p>
		<ul>
			<li>
				<strong>Ingest-time</strong> (<code>transform_failed</code>,
				<code>source_map_failed</code>, <code>import_parse_failed</code>,
				<code>resolver_failed</code>): surfaced via <code>setFile</code> / <code>setFiles</code>
				returns and durable on the owned entry. Survive subsequent <code>query</code> calls until the
				entry is replaced or deleted.
			</li>
			<li>
				<strong>Query-time</strong> (the rest): recomputed on every <code>query</code> call.
				Returned in <code>AnalyzeResultJson.diagnostics</code>.
			</li>
		</ul>
		<p>
			<code>query()</code> returns analysis-pass diagnostics only; it does NOT include ingest
			diagnostics. Concat with prior <code>setFile</code> / <code>setFiles</code> returns for the
			full picture, or call <code>allIngestDiagnostics()</code> for the cumulative ingest view across
			every owned entry:
		</p>
		<Code
			lang="ts"
			content={`const queryResult = session.query();
const fullDiagnostics = [
  ...session.allIngestDiagnostics(),
  ...queryResult.diagnostics,
];`}
		/>
		<p>
			<code>allIngestDiagnostics</code> is the publish path for long-lived consumers. It lets the Vite
			plugin republish the cumulative ingest picture on every HMR cycle without tracking per-batch returns,
			and lets an LSP push a complete diagnostic set to the client on demand. Cheap: walks the owned map.
		</p>
		<p>
			Discovery-time diagnostics (<code>module_unreadable</code> from
			<code>discoverFromExports</code>) are a third category. The session doesn't run discovery, so
			direct consumers own those: track them in a side-channel field for HMR survival as the Vite
			plugin does, or run discovery once and merge into the first query.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Worked example: incremental loop" />
		<p>
			Sketch of an LSP-style edit/save/query loop. Each <code>setFile</code> updates a single file;
			<code>query</code> reanalyzes the whole owned set but reuses parsed ASTs and svelte2tsx output for
			unchanged files.
		</p>
		<Code
			lang="ts"
			content={`import {createAnalysisSession, createSourceOptions, hasErrors} from 'svelte-docinfo';

const session = createAnalysisSession({
  sourceOptions: createSourceOptions(process.cwd()),
});

// Initial population.
await session.setFiles([
  {id: '/abs/src/lib/a.ts', content: '...'},
  {id: '/abs/src/lib/b.ts', content: '...'},
]);

// Edit: one file changed.
const {changed, diagnostics: ingest} = await session.setFile({
  id: '/abs/src/lib/a.ts',
  content: '... new content ...',
});

if (changed) {
  const {modules, diagnostics: pass} = session.query();
  const all = [...session.allIngestDiagnostics(), ...pass];
  if (hasErrors(all)) {
    // surface to the editor
  }
}

// Tear down.
session.dispose();`}
		/>
		<p>
			For HMR / file-watcher consumers, <code>setFiles</code> on the batch of changed paths in one
			call is preferable to looping <code>setFile</code>: it shares the
			<code>ensureLexerReady</code> warmup and runs the resolve phase in parallel with a bounded worker
			pool.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="When to use one-shot APIs instead" />
		<p>
			If you only call analysis once (CLI, CI pipeline, one-off doc generation), use
			<DeclarationLink name="analyze" /> or
			<DeclarationLink name="analyzeFromFiles" /> directly. They create a single-use session, run it,
			and dispose. There's no caching benefit to keeping a session alive across one call. See
			<ModuleLink module_path="session.ts">session.ts</ModuleLink> for the full type definitions and
			<TomeLink slug="diagnostics" /> for the diagnostic kinds.
		</p>
	</TomeSection>
</TomeContent>
