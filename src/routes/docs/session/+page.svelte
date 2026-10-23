<script lang="ts">
	import Code from '@fuzdev/fuz_code/Code.svelte';
	import TomeContent from '@fuzdev/fuz_ui/TomeContent.svelte';
	import TomeSection from '@fuzdev/fuz_ui/TomeSection.svelte';
	import TomeSectionHeader from '@fuzdev/fuz_ui/TomeSectionHeader.svelte';
	import DeclarationLink from '@fuzdev/fuz_ui/DeclarationLink.svelte';
	import ModuleLink from '@fuzdev/fuz_ui/ModuleLink.svelte';
	import TomeLink from '@fuzdev/fuz_ui/TomeLink.svelte';
	import { tome_get_by_slug } from '@fuzdev/fuz_ui/tome.ts';

	const LIBRARY_ITEM_NAME = 'session';

	const tome = tome_get_by_slug(LIBRARY_ITEM_NAME);
</script>

<svelte:head>
	<title>session - svelte-docinfo</title>
</svelte:head>

<TomeContent {tome}>
	<section>
		<p>
			<DeclarationLink name="createAnalysisSession" /> returns a persistent analysis handle backed
			by a TypeScript <code>LanguageService</code>. Use it when the same source set is re-analyzed
			repeatedly (Vite plugin, LSP-style tools): parsed ASTs, svelte2tsx output, and the dependency
			graph are reused across cycles. The one-shot <DeclarationLink name="analyze" /> and
			<DeclarationLink name="analyzeFromFiles" /> wrap single-use sessions; if you analyze once
			(CLI, CI, one-off generation), use them instead. The full type definitions are in
			<ModuleLink module_path="session.ts">session.ts</ModuleLink>.
		</p>
	</section>

	<TomeSection>
		<TomeSectionHeader text="Construction" />
		<Code
			lang="ts"
			content={`import {createAnalysisSession, createSourceOptions} from 'svelte-docinfo';

const session = createAnalysisSession({
  sourceOptions: createSourceOptions(process.cwd()),
  // Optional: session-default ImportResolver (or a bare resolve function).
  // Defaults to TypeScript module resolution with your tsconfig.
  // resolveImport: myResolver,
  // Optional (default true): also ingest the in-project files your inputs
  // import that you didn't supply, as non-emitting context.
  // contextClosure: true,
  // Optional: a tsconfig path relative to the project root, or false to
  // analyze without one. Default: 'tsconfig.json'.
  // tsconfig: 'tsconfig.lib.json',
  // Optional: the program's root files, in place of the tsconfig's.
  // rootFileNames: declarationFileRoots, // from 'svelte-docinfo/typescript-program.js'
  // Optional: logger for session-level messages.
  // log: console,
});`}
		/>
		<p>
			<DeclarationLink name="AnalysisSessionOptions" /> requires complete
			<code>ModuleSourceOptions</code>; build them with
			<DeclarationLink name="createSourceOptions" />, which merges your overrides with
			<DeclarationLink name="DEFAULT_SOURCE_OPTIONS" />. The session applies no further defaults.
		</p>
		<p>
			The tsconfig (the <code>tsconfig</code> option, or the project's) is parsed once, at
			construction. <code>compilerOptions</code> merge over it per key, and the type checker and
			default resolver both see the merged result. The tsconfig file is required and its whole
			<code>extends</code> chain must load, unless you pass <code>tsconfig: false</code>, which
			skips the file and uses built-in strict options
			(<DeclarationLink name="DEFAULT_COMPILER_OPTIONS" />) under your <code>compilerOptions</code>.
			Later edits to the tsconfig aren't picked up; create a new session.
		</p>
		<p>
			By default every file the tsconfig includes is a root of the program, so a session fed a few
			files of a large project still loads all of it. <code>rootFileNames</code> replaces those
			roots with a list, or filters them with a function. The files you ingest and everything they
			import are always loaded, so narrowing changes output only for types that arrive through no
			import: ambient declarations in a file nothing imports resolve to <code>any</code> once that
			file stops being a root. Keeping the <code>.d.ts</code> roots, as above, covers the usual
			case; see <DeclarationLink name="RootFileNames" />.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Lifecycle" />
		<p>The session owns a source set that you add to, update, and remove from:</p>
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
						Ingest one file's content; a no-op on cache hit. Returns
						<DeclarationLink name="SetFileResult" />
					</td>
				</tr>
				<tr>
					<td class="white-space:nowrap"><code>setFiles(files, opts?)</code></td>
					<td>
						Ingest a batch. Additive; never removes. Returns
						<DeclarationLink name="SetFilesResult" /> with aggregate and per-file views
					</td>
				</tr>
				<tr>
					<td class="white-space:nowrap"><code>deleteFile(id)</code></td>
					<td>Remove a file from the session</td>
				</tr>
				<tr>
					<td class="white-space:nowrap"><code>has(id)</code></td>
					<td>Whether the given absolute path is currently owned</td>
				</tr>
				<tr>
					<td class="white-space:nowrap"><code>list()</code></td>
					<td>Snapshot of owned file IDs (insertion order), context files included</td>
				</tr>
				<tr>
					<td class="white-space:nowrap"><code>query(opts?)</code></td>
					<td>
						Analyze the owned set. Files outside <code>sourcePaths</code>, matching
						<code>exclude</code>, or held as context inform type resolution but emit no module.
						Returns <DeclarationLink name="AnalyzeResultJson" />
					</td>
				</tr>
				<tr>
					<td class="white-space:nowrap"><code>allIngestDiagnostics()</code></td>
					<td>Cumulative ingest-time diagnostics across every owned entry</td>
				</tr>
				<tr>
					<td class="white-space:nowrap"><code>getProgram()</code></td>
					<td>
						The underlying <code>ts.Program</code>, for your own checker work. It goes stale after
						any <code>setFile</code>, <code>setFiles</code>, or <code>deleteFile</code> that changes
						the session, so call it again afterward
					</td>
				</tr>
				<tr>
					<td class="white-space:nowrap"><code>dispose()</code></td>
					<td>Release resources and clear the owned set. Don't use the session afterward</td>
				</tr>
			</tbody>
		</table>
		<p>
			<strong>Concurrency.</strong> The session isn't safe for overlapping calls, so serialize them.
			<code>setFile</code>, <code>setFiles</code>, and <code>deleteFile</code> are async (resolvers
			may await I/O); <code>query</code> is sync and reads the current owned set, so await pending
			ingests first.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Cache-hit semantics" />
		<p>
			Re-ingesting a file either reuses everything cached for it or recomputes everything. What
			counts as a hit depends on the mode:
		</p>
		<ul>
			<li>
				<strong>lex+resolve</strong> (default): identical content and the same
				<DeclarationLink name="ImportResolver" /> <code>identity</code>.
			</li>
			<li>
				<strong>pre-resolved</strong> (caller supplies <code>SourceFileInfo.dependencies</code>):
				identical content and an element-wise equal array. A fresh array with the same elements
				hits, so <code>[...filer.deps.keys()]</code> per call works; any length, element, or order
				difference misses. The dependencies are trusted unchecked; see
				<TomeLink slug="build-tools" hash="Trust-contract">trust contract</TomeLink>.
			</li>
		</ul>
		<p>Switching a file between modes always misses.</p>
		<p>
			Unresolved imports are the exception: a file's edges can change without re-ingesting it. When
			a <code>setFile</code> / <code>setFiles</code> call adds files, the session retries specifiers
			that previously resolved to <code>null</code> in lex+resolve files (with the same resolver),
			updates their edges, and clears stale <code>resolver_failed</code> diagnostics. It also calls
			the resolver's optional <code>invalidate()</code> before the next batch whenever files were
			added or removed since it last ran, so cached failed lookups don't stick. Pre-resolved files
			are untouched.
		</p>
		<p>
			On a hit, <code>SetFileResult.changed</code> is <code>false</code> and the cached ingest
			diagnostics are returned without doing any work, unless the call changes the file's role
			(<code>context</code>), which reports <code>changed: true</code> since the emitted set moves.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="ImportResolver and identity" />
		<p>
			<DeclarationLink name="ImportResolver" /> is
			<code>{`{resolve, identity, invalidate?}`}</code>. <code>identity</code> is a stable opaque
			token (string or symbol) that keys the cache alongside content; <code>invalidate()</code>
			clears any cached failed lookups when files are added or removed.
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
			<code>identity</code> is required because function references make poor cache keys: callers
			often wrap a resolver in a fresh closure per call (a common Vite/Rollup pattern), which would
			defeat caching. Reuse the same token as long as resolution behaves the same, and change it
			when it doesn't.
		</p>
		<p>
			<code>resolveImport</code> also accepts a bare resolve function. The session-level one is
			wrapped once at construction, so its identity is stable; a bare function passed per call gets
			a fresh identity every call, and so never cache-hits.
		</p>
		<p>
			When neither <code>AnalysisSessionOptions.resolveImport</code> nor a per-call
			<DeclarationLink name="SetFileOptions" />.<code>resolveImport</code> is supplied, the session
			builds a default from TypeScript module resolution and the merged compiler options on first
			use. It sees files that exist only in the session, even in directories absent from disk; a
			custom resolver must handle in-memory files itself to get dependency edges for them.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Context files" />
		<p>
			By default a session also ingests the in-project files its sources import that you didn't
			supply (transitively, skipping <code>node_modules</code> and dot-directories), so edits to
			them, like <code>internal/</code> modules, stay live instead of being read from disk once.
			These context files emit no modules and add no edges. Their imports always go through
			lex+resolve, so when the closure finds files, even a fully pre-resolved session builds the
			default resolver (unless you supply <code>resolveImport</code>). <code>analyze()</code> turns
			the closure off; <code>analyzeFromFiles</code> keeps it on.
		</p>
		<p>
			That includes source files, such as a component left out of <code>package.json</code>
			<code>exports</code>, or the rest of the project when you hand over one component. The type
			checker can only read a component through its transformed form, so without the ingest every
			type drawn from that component would be <code>any</code>. Such a file still emits no module
			until you supply it yourself. Each <code>setFile</code>/<code>setFiles</code> call sets the
			role of its files: they're inputs by default, so to forward an edit to a context file without
			turning it into a module, pass <code>{'{context: true}'}</code>. With the closure off, as in
			<code>analyze()</code>, pass every component the checker needs.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Diagnostics: ingest-time vs query-time" />
		<p>Diagnostic kinds have two lifecycles:</p>
		<ul>
			<li>
				<strong>Ingest-time</strong> (<code>transform_failed</code>, <code>source_map_failed</code>,
				<code>import_parse_failed</code>, <code>resolver_failed</code>): returned from
				<code>setFile</code> / <code>setFiles</code> and kept with the file until it is re-ingested
				or deleted. A <code>resolver_failed</code> also clears once a later batch resolves its
				specifier.
			</li>
			<li>
				<strong>Query-time</strong> (the rest): recomputed and returned by every <code>query</code>
				call.
			</li>
		</ul>
		<p>
			<code>query()</code> does <em>not</em> include ingest diagnostics, and <code>setFile</code> /
			<code>setFiles</code> return only those for the files you passed (not context-closure files).
			<code>allIngestDiagnostics()</code> returns the complete set for every owned file:
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
			It's cheap, so long-lived consumers can republish the full picture every cycle without
			tracking per-batch returns. The Vite plugin does this on every dev re-analysis.
		</p>
		<p>
			Discovery-time diagnostics (<code>module_unreadable</code>) are a third category. Sessions
			don't run discovery, so if you do, keep those diagnostics yourself and merge them into what
			you publish (see
			<TomeLink slug="build-tools" hash="discoverSourceFiles-standalone">
				discoverSourceFiles
			</TomeLink>).
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Worked example: incremental loop" />
		<p>
			An LSP-style edit/query loop. Each <code>setFile</code> updates one file; <code>query</code>
			reanalyzes, reusing parsed ASTs and svelte2tsx output for unchanged files.
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
const {changed} = await session.setFile({
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
			For HMR and file watchers, pass all changed files to one <code>setFiles</code> call rather
			than looping <code>setFile</code>: a batch resolves imports in parallel.
		</p>
	</TomeSection>
</TomeContent>
