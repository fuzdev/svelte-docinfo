<script lang="ts">
	import Code from '@fuzdev/fuz_code/Code.svelte';
	import TomeContent from '@fuzdev/fuz_ui/TomeContent.svelte';
	import TomeSection from '@fuzdev/fuz_ui/TomeSection.svelte';
	import TomeSectionHeader from '@fuzdev/fuz_ui/TomeSectionHeader.svelte';
	import DeclarationLink from '@fuzdev/fuz_ui/DeclarationLink.svelte';
	import ModuleLink from '@fuzdev/fuz_ui/ModuleLink.svelte';
	import TomeLink from '@fuzdev/fuz_ui/TomeLink.svelte';
	import { tome_get_by_slug } from '@fuzdev/fuz_ui/tome.ts';

	const LIBRARY_ITEM_NAME = 'build-tools';

	const tome = tome_get_by_slug(LIBRARY_ITEM_NAME);
</script>

<svelte:head>
	<title>build-tool integration - svelte-docinfo</title>
</svelte:head>

<TomeContent {tome}>
	<section>
		<p>
			svelte-docinfo is build-tool agnostic: you hand it files as
			<DeclarationLink name="SourceFileInfo" /> objects, from disk, a build pipeline, or editor
			buffers. This page covers embedding analysis in a bundler, watcher, or LSP-style tool that the
			<TomeLink slug="vite-plugin">Vite plugin</TomeLink> doesn't fit.
		</p>
		<p>
			The analyzer reads the disk only for the tsconfig, for type-checker context you don't supply,
			and, except in <code>analyze()</code>, for the in-project non-source files your sources import
			(<a href="#Context-files">context files</a>).
		</p>
	</section>

	<TomeSection>
		<TomeSectionHeader text="SourceFileInfo" />
		<p>
			Every entry point takes <DeclarationLink name="SourceFileInfo" />, including
			<DeclarationLink name="analyze" /> and the session's <code>setFile</code> /
			<code>setFiles</code>; <DeclarationLink name="discoverSourceFiles" /> returns it:
		</p>
		<Code
			lang="ts"
			content={`interface SourceFileInfo {
  id: string;                  // absolute path (native ok at boundary)
  content: string;             // file contents
  dependencies?: string[];     // optional: pre-resolved deps (opt-in)
}`}
		/>
		<ul>
			<li>
				<strong><code>id</code></strong>: absolute path. Native Windows paths are accepted (see
				<a href="#Paths-POSIX-form-contract">Paths</a>).
			</li>
			<li>
				<strong><code>content</code></strong>: required; inputs are never read from disk.
			</li>
			<li>
				<strong><code>dependencies</code></strong>: optional absolute paths. When supplied, the
				session skips its own import parsing for this file (see
				<a href="#Pre-resolved-dependencies-fast-path">Pre-resolved dependencies</a>).
			</li>
		</ul>
		<p>Reverse edges (<code>dependents</code>) are always computed by the analyzer.</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Three entry points by ownership" />
		<p>Pick by what your tool already owns:</p>
		<table>
			<thead>
				<tr>
					<th class="white-space:nowrap">Use</th>
					<th>When</th>
				</tr>
			</thead>
			<tbody>
				<tr>
					<td><DeclarationLink name="analyzeFromFiles" /></td>
					<td>
						You own a project root and want everything in one call: file discovery, dependency
						resolution, analysis. CLI-style.
					</td>
				</tr>
				<tr>
					<td><DeclarationLink name="analyze" /></td>
					<td>
						You already hold file contents in memory (a Rollup/esbuild plugin with files in the
						bundle graph). Single-pass, one-shot.
					</td>
				</tr>
				<tr>
					<td><DeclarationLink name="createAnalysisSession" /></td>
					<td>
						You re-analyze the same source set across many cycles (Vite, watch mode, LSP). See the
						<TomeLink slug="session" /> guide.
					</td>
				</tr>
			</tbody>
		</table>
		<p>
			The one-shot APIs are thin wrappers over single-use sessions, with the same diagnostics and
			output shape.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="discoverSourceFiles (standalone)" />
		<p>
			<DeclarationLink name="discoverSourceFiles" /> runs file discovery without analysis, for tools
			that need the source set up front (watcher registration, counts, pre-flight checks) and
			analyze separately.
		</p>
		<Code
			lang="ts"
			content={`import {discoverSourceFiles, createSourceOptions} from 'svelte-docinfo';

const {files, diagnostics} = await discoverSourceFiles({
  sourceOptions: createSourceOptions(process.cwd()),
  // discovery: 'auto' | 'exports' | 'glob'  (default 'auto')
  // include: ['src/**/*.ts']                (forces glob under 'auto')
  // distDir: 'dist'                         (for exports discovery)
});

// files: Array<SourceFileInfo> — content already loaded from disk
// diagnostics: module_unreadable for any file the exports map names
//   but readFile failed on (permission denied, FS error)`}
		/>
		<p>
			The strategies match the CLI and Vite plugin: <code>'auto'</code> tries
			<code>package.json</code> exports and falls back to glob, <code>'exports'</code> is strict
			(throws if exports is missing or resolves to no files), and <code>'glob'</code> skips exports.
			Passing <code>include</code> under <code>'auto'</code> goes straight to glob, so the filter is
			never silently ignored.
		</p>
		<p>
			Unlike <code>analyzeFromFiles</code> and the Vite plugin, standalone discovery doesn't widen
			<code>sourcePaths</code> to cover <code>include</code>, so files outside <code>src/lib</code>
			would be dropped at analysis. To keep them, build the options with
			<DeclarationLink name="createSourceOptionsWithInclude" /> (from
			<code>svelte-docinfo/source-config.js</code>), passing the same <code>include</code>.
		</p>
		<p>
			Session consumers own the discovery-time <code>module_unreadable</code> diagnostics, since
			sessions don't run discovery (<code>analyzeFromFiles</code> merges them for you). Their
			<code>message</code> embeds the filesystem error's absolute path, so pass them through
			<DeclarationLink name="normalizeDiagnosticPaths" /> (from
			<code>svelte-docinfo/analyze-core.js</code>) before publishing.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Pre-resolved dependencies (fast path)" />
		<p>
			Build tools with their own dependency graph (Gro's filer, Rollup's bundle graph, webpack's
			module graph) can hand it over in <code>SourceFileInfo.dependencies</code> as absolute paths.
			The session then skips import parsing and resolution for that file.
		</p>
		<Code
			lang="ts"
			content={`import type {SourceFileInfo} from 'svelte-docinfo';

// inside your build-tool integration
const files: Array<SourceFileInfo> = [...filer.modules].map(([id, mod]) => ({
  id,
  content: mod.content,
  dependencies: [...mod.dependencies.keys()],  // absolute paths
}));

await session.setFiles(files);`}
		/>
		<p>
			A file re-ingested with the same content and an element-wise equal <code>dependencies</code>
			array is a cache hit, so building a fresh array per call is fine. See
			<TomeLink slug="session" hash="Cache-hit-semantics">Cache-hit semantics</TomeLink>.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Trust contract" />
		<p>
			Pre-resolved dependencies are trusted: the session doesn't check them against
			<code>content</code>. A buggy upstream resolver goes unnoticed:
		</p>
		<ul>
			<li>
				Edges in <code>dependencies</code> but absent from <code>content</code> are accepted.
			</li>
			<li>
				Imports in <code>content</code> but missing from <code>dependencies</code> are omitted.
			</li>
		</ul>
		<p>
			Neither case emits a diagnostic, because legitimate sequences across batches (declaring a
			dependency on a file that is set later, or later deleted) would be flagged too. The default
			lex+resolve path always follows the actual imports, so use it if you don't fully trust your
			dependency source.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Type-only edges" />
		<p>
			With pre-resolved dependencies, you decide whether <code>import type {`{X}`} from './x'</code>
			counts as a dependency. Two common stances:
		</p>
		<ul>
			<li>
				<strong>Keep type-only edges</strong>: what the default lex+resolve path does for
				<code>import type</code> and inline <code>type</code> specifiers (type-only re-exports like
				<code>export type {`{X}`} from</code> produce no edge).
			</li>
			<li>
				<strong>Drop type-only edges</strong>: what Gro's filer does, so the output reflects the
				runtime graph only.
			</li>
		</ul>
		<p>
			Switching from lex+resolve to Gro's graph therefore removes type-only edges from
			<code>ModuleJson.dependencies</code> and <code>dependents</code>.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="ImportResolver (lex+resolve path)" />
		<p>
			Without pre-resolved dependencies, the session parses import specifiers from
			<code>content</code> and resolves them through an <DeclarationLink name="ImportResolver" />.
			Wire in your own so resolution matches the rest of your build:
		</p>
		<Code
			lang="ts"
			content={`import {createAnalysisSession, createSourceOptions} from 'svelte-docinfo';
import type {ImportResolver} from 'svelte-docinfo';

const resolver: ImportResolver = {
  identity: 'my-bundler@v1',
  resolve: (specifier, fromFile) => bundler.resolve(specifier, fromFile),
};

const session = createAnalysisSession({
  sourceOptions: createSourceOptions(process.cwd()),
  resolveImport: resolver,
});`}
		/>
		<p>
			<code>identity</code> is a stable cache token; see the <TomeLink slug="session" /> guide.
			Without a resolver, the session uses a default built on TypeScript module resolution and your
			tsconfig.
		</p>
		<p>
			Implement the optional <code>invalidate()</code> if your resolver caches failed lookups: the
			session calls it before a batch whenever files were added to or removed from the session,
			since a specifier that resolved to nothing may resolve now. The default resolver also sees
			files that exist only in the session (even in directories absent from disk); a custom resolver
			must handle in-memory files itself to get dependency edges for them.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Context files" />
		<p>
			By default a session also ingests the in-project, non-source files its sources import
			(transitively, skipping <code>node_modules</code> and dot-directories), so edits to them, like
			<code>internal/</code> modules, stay live instead of being read from disk once. These context
			files emit no modules and add no edges. Their imports always go through lex+resolve, so when
			the closure finds files, even a fully pre-resolved session builds the default resolver (unless
			you supply <code>resolveImport</code>). <code>analyze()</code> turns the closure off;
			<code>analyzeFromFiles</code> keeps it on.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Source options and the source root" />
		<p>
			<DeclarationLink name="createSourceOptions" /> builds the
			<DeclarationLink name="ModuleSourceOptions" /> the session needs. Customize for non-default
			layouts:
		</p>
		<Code
			lang="ts"
			content={`import {createSourceOptions} from 'svelte-docinfo';

// Default: single sourcePaths=['src/lib'], test/spec + internal/ exclude.
const opts = createSourceOptions(process.cwd());

// Monorepo: multiple source directories, optional explicit sourceRoot.
const monorepoOpts = createSourceOptions(process.cwd(), {
  sourcePaths: ['packages/a/src', 'packages/b/src'],
  // sourceRoot derived as longest common prefix when omitted.
});

// Extend the default exclude (callback form — the array form replaces).
const customOpts = createSourceOptions(process.cwd(), {
  exclude: (defaults) => [...defaults, '**/fixtures/**'],
});`}
		/>
		<p>
			<code>sourceRoot</code> is the base of <code>ModuleJson.path</code>; pass <code>'.'</code> for
			project-relative paths.
		</p>
		<p>
			<code>exclude</code> applies at both discovery and analysis, so an excluded file never appears
			in output however it was found. The defaults cover tests and the
			<code>src/lib/internal/</code> convention (<code>**/internal/**</code>: internal modules that
			public modules import but that aren't documented). An array replaces the defaults; the
			callback form extends them. Independent of <code>exclude</code>, <code>node_modules</code> and
			dot-directories below a source path are never source. That rule is relative to the source
			path, so an explicit dot-directory source path (<code>sourcePaths: ['.hidden/src']</code>)
			still works.
		</p>
		<p>
			<code>sourcePaths</code> and <code>sourceRoot</code> are relative to the project root.
			Absolute entries inside the root are accepted and stored relative; entries outside it throw
			when the options are created, since output paths can't represent them. Absolute
			<code>exclude</code> globs (and <code>include</code> patterns at the discovery entry points)
			follow the same rule.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Paths: POSIX-form contract" />
		<p>
			Native paths are accepted at the API boundary and converted to POSIX form (forward slashes) on
			ingest, so Windows callers can pass <code>C:\repo\src\lib\foo.ts</code>.
			<code>ModuleJson.path</code>, <code>Diagnostic.file</code>, and the session's
			<code>list()</code> always report POSIX form.
		</p>
		<p>
			Drive-letter case (<code>C:\</code> vs <code>c:\</code>) and extended-length <code>\\?\</code>
			prefixes are not normalized. See <ModuleLink module_path="paths.ts">paths.ts</ModuleLink>.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Concurrency caps" />
		<p>
			File reads and resolver calls each run with bounded parallelism
			(<code>MAX_FILE_CONCURRENCY</code> and <code>MAX_RESOLVE_CONCURRENCY</code> in
			<ModuleLink module_path="concurrency.ts">concurrency.ts</ModuleLink>), so a custom resolver
			never sees an unbounded burst of concurrent calls.
		</p>
	</TomeSection>
</TomeContent>
