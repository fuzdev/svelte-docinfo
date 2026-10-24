<script lang="ts">
	import Code from '@fuzdev/fuz_code/Code.svelte';
	import TomeContent from '@fuzdev/fuz_ui/TomeContent.svelte';
	import TomeSection from '@fuzdev/fuz_ui/TomeSection.svelte';
	import TomeSectionHeader from '@fuzdev/fuz_ui/TomeSectionHeader.svelte';
	import DeclarationLink from '@fuzdev/fuz_ui/DeclarationLink.svelte';
	import TomeLink from '@fuzdev/fuz_ui/TomeLink.svelte';
	import { tome_get_by_slug } from '@fuzdev/fuz_ui/tome.ts';

	const LIBRARY_ITEM_NAME = 'build-tools';

	const tome = tome_get_by_slug(LIBRARY_ITEM_NAME);
</script>

<svelte:head>
	<title>build tools - svelte-docinfo</title>
</svelte:head>

<TomeContent {tome}>
	<section>
		<p>
			svelte-docinfo is build-tool agnostic: you hand it files as
			<DeclarationLink name="SourceFileInfo" /> objects, from disk, a build pipeline, or editor
			buffers. This page covers embedding analysis in a bundler, watcher, or editor tool, beyond the
			<TomeLink slug="js-api">JS API</TomeLink> basics.
		</p>
		<p>
			Apart from discovery in <code>analyzeFromFiles</code>, the analyzer reads the disk only for
			the tsconfig, for type-checker context you don't supply, and, except in
			<code>analyze()</code>, for the in-project files your inputs import that you didn't supply
			(<TomeLink slug="session" hash="Context-files">context files</TomeLink>).
		</p>
	</section>

	<TomeSection>
		<TomeSectionHeader text="SourceFileInfo" />
		<p>
			<DeclarationLink name="analyze" /> and the session's <code>setFile</code> /
			<code>setFiles</code> take <DeclarationLink name="SourceFileInfo" />, and
			<DeclarationLink name="discoverSourceFiles" /> returns it:
		</p>
		<Code
			lang="ts"
			content={`interface SourceFileInfo {
  id: string;                  // absolute path (native ok at boundary)
  content: string;             // file contents
  dependencies?: ReadonlyArray<string>; // optional: pre-resolved deps
}`}
		/>
		<ul>
			<li>
				<strong><code>id</code></strong>: absolute path. Native Windows paths are accepted (see
				<a href="#Paths">Paths</a>).
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
			The strategies are the ones
			<TomeLink slug="source-files" hash="Discovery">discovery</TomeLink> describes.
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
				<strong>Keep type-only edges</strong>: what the default lex+resolve path does, for
				<code>import type</code>, inline <code>type</code> specifiers, and type-only re-exports like
				<code>export type {`{X}`} from</code>.
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
		<TomeSectionHeader text="Custom import resolution" />
		<p>
			Without pre-resolved dependencies, the session parses import specifiers from
			<code>content</code> and resolves them with TypeScript module resolution and your tsconfig. To
			match the rest of your build instead, pass an <DeclarationLink name="ImportResolver" /> as
			<code>resolveImport</code>; see the
			<TomeLink slug="session" hash="ImportResolver-and-identity">session</TomeLink> guide.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Paths" />
		<p>
			Native paths are accepted at the API boundary, so Windows callers can pass
			<code>C:\repo\src\lib\foo.ts</code>. Every path in the output, and the session's
			<code>list()</code>, is POSIX form (forward slashes). Drive-letter case and <code>\\?\</code>
			prefixes aren't normalized.
		</p>
	</TomeSection>
</TomeContent>
