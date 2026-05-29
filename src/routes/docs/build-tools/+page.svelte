<script lang="ts">
	import Code from '@fuzdev/fuz_code/Code.svelte';
	import TomeContent from '@fuzdev/fuz_ui/TomeContent.svelte';
	import TomeSection from '@fuzdev/fuz_ui/TomeSection.svelte';
	import TomeSectionHeader from '@fuzdev/fuz_ui/TomeSectionHeader.svelte';
	import DeclarationLink from '@fuzdev/fuz_ui/DeclarationLink.svelte';
	import ModuleLink from '@fuzdev/fuz_ui/ModuleLink.svelte';
	import TomeLink from '@fuzdev/fuz_ui/TomeLink.svelte';
	import {tome_get_by_slug} from '@fuzdev/fuz_ui/tome.js';

	const LIBRARY_ITEM_NAME = 'build-tools';

	const tome = tome_get_by_slug(LIBRARY_ITEM_NAME);
</script>

<svelte:head>
	<title>build-tool integration - svelte-docinfo</title>
</svelte:head>

<TomeContent {tome}>
	<section>
		<p>
			svelte-docinfo is build-tool agnostic. Files come in through
			<DeclarationLink name="SourceFileInfo" /> objects (absolute path plus content, optionally with pre-resolved
			dependencies), and the analyzer never touches disk on its own. This page covers the integration
			surface for embedding analysis inside a bundler, watcher, or LSP-style tool that doesn't fit the
			bundled <TomeLink slug="vite-plugin">Vite plugin</TomeLink>.
		</p>
	</section>

	<TomeSection>
		<TomeSectionHeader text="SourceFileInfo" />
		<p>
			Every analysis entry point, including <DeclarationLink name="analyze" />,
			<DeclarationLink name="createAnalysisSession" />'s <code>setFile</code> /
			<code>setFiles</code>, and even <DeclarationLink name="discoverSourceFiles" />'s output,
			operates on <DeclarationLink name="SourceFileInfo" />:
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
				<strong><code>id</code></strong>: absolute path. Native paths are accepted at the public-API
				boundary and posixified at ingest (Windows backslash paths become forward-slash internally).
				After ingest, every comparison and output field uses POSIX form.
			</li>
			<li>
				<strong><code>content</code></strong>: required, since analysis functions don't read from
				disk. Files may come from any source: filesystem, build pipeline, in-memory editor buffer.
			</li>
			<li>
				<strong><code>dependencies</code></strong>: opt-in. When supplied, the session skips its
				lex+resolve pass for this entry and treats the array as authoritative. See "Pre-resolved
				dependencies" below.
			</li>
		</ul>
		<p>
			Reverse edges (<code>dependents</code>) are computed inside the analyzer from forward edges,
			never caller-supplied.
		</p>
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
						You re-analyze the same source set across many cycles (Vite, watch mode, LSP). See the <TomeLink
							slug="session"
						/> guide.
					</td>
				</tr>
			</tbody>
		</table>
		<p>
			The one-shot APIs are thin wrappers over single-use sessions. They share the same two-phase
			analysis loop, same diagnostic model, same output shape.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="discoverSourceFiles (standalone)" />
		<p>
			<DeclarationLink name="discoverSourceFiles" /> runs file discovery without analysis. Useful when
			your tool wants to know the source set up front (for watcher-glob registration, count displays,
			pre-flight checks) but defers analysis to a separate pass.
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
			Discovery strategies match the CLI and Vite plugin: <code>'auto'</code> tries package.json
			exports first and falls back to glob; <code>'exports'</code> is strict (throws if exports is
			missing); <code>'glob'</code> skips exports entirely. Providing
			<code>include</code> under <code>'auto'</code> collapses the chain to glob immediately, since
			honoring it from exports discovery would silently drop the user's filter on packages with an
			<code>exports</code> field.
		</p>
		<p>
			<code>module_unreadable</code> is the discovery-time diagnostic; the session doesn't run
			discovery, so direct session consumers own it. <code>analyzeFromFiles</code> merges discovery diagnostics
			into the final return before handing back to the caller.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Pre-resolved dependencies (fast path)" />
		<p>
			Build tools that already maintain a dependency graph (Gro's filer, Rollup's bundle graph,
			webpack's module graph) can hand it over by populating
			<code>SourceFileInfo.dependencies</code> with absolute paths. The session then skips its lex+resolve
			pass for that entry entirely.
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
			The cache key for the entry shifts to
			<code>(content, dependencies-element-wise-equal)</code> instead of
			<code>(content, resolverIdentity)</code>. A fresh array per call cache-hits cleanly as long as
			the contents match, with no upstream memoization needed. The session snapshots the array at
			ingest, so mid-flight mutation of the caller's array won't produce false hits.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Trust contract" />
		<p>
			The pre-resolved path is trust mode: the session does not cross-check declared dependencies
			against the file's <code>content</code>. Two consequences a buggy resolver upstream will hit
			silently:
		</p>
		<ul>
			<li>
				Edges declared in <code>dependencies</code> but absent from <code>content</code> are accepted
				as-is.
			</li>
			<li>
				Edges present in <code>content</code> but missing from <code>dependencies</code> are silently
				omitted.
			</li>
		</ul>
		<p>
			There's no diagnostic for either case, because legitimate cross-batch sequences
			(declare-then-set, declare-then-delete) would produce noise. The lex+resolve fallback path has
			no such hole; its edges are always grounded in syntactic imports. If you don't fully trust the
			dependency source you're handing in, use lex+resolve and pay the parse cost.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Type-only edges" />
		<p>
			Whether <code>import type {`{X}`} from './x'</code> shows up as a dependency is the caller's decision
			under the pre-resolved path. Two common stances:
		</p>
		<ul>
			<li>
				<strong>Keep type-only edges</strong>: what default lex+resolve does (<code
					>es-module-lexer</code
				>
				doesn't distinguish them). The output's <code>ModuleJson.dependencies</code> matches the syntactic
				import set.
			</li>
			<li>
				<strong>Drop type-only edges</strong>: what Gro's filer (<code>parse_imports</code> with
				<code>ignore_types=true</code>) does. Type imports aren't runtime deps; the output reflects
				runtime graph only.
			</li>
		</ul>
		<p>
			Both are valid; the pre-resolved path defers the policy to the caller. Switching from
			lex+resolve to pre-resolved-via-Gro will visibly remove type-only edges from
			<code>ModuleJson.dependencies</code> / <code>dependents</code> for affected modules.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="ImportResolver (lex+resolve path)" />
		<p>
			When you don't hand over pre-resolved dependencies, the session lexes specifiers from
			<code>content</code> and passes them through an
			<DeclarationLink name="ImportResolver" />. Build-tool integrations typically want to wire
			their own resolver in so module resolution matches what the rest of the build does:
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
			<code>identity</code> is the stable cache token. See the <TomeLink slug="session" /> guide for why
			it's required and how to choose one. When omitted entirely, the session lazily constructs a TS +
			tsconfig default on first use, but only if at least one file in any batch lacks
			<code>dependencies</code>. Fully pre-resolved batches never trigger the default and skip the
			<code>loadTsconfig</code> call entirely.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Source options and the source root" />
		<p>
			<DeclarationLink name="createSourceOptions" /> builds the
			<DeclarationLink name="ModuleSourceOptions" /> the session needs. Customize for non-default project
			layouts:
		</p>
		<Code
			lang="ts"
			content={`import {createSourceOptions} from 'svelte-docinfo';

// Default: single sourcePaths=['src/lib'], standard test/spec exclude.
const opts = createSourceOptions(process.cwd());

// Monorepo: multiple source directories, optional explicit sourceRoot.
const monorepoOpts = createSourceOptions(process.cwd(), {
  sourcePaths: ['packages/a/src', 'packages/b/src'],
  // sourceRoot derived as longest common prefix when omitted.
});

// Custom exclude (replaces defaults entirely — no merge).
const customOpts = createSourceOptions(process.cwd(), {
  exclude: ['**/*.test.ts', '**/*.spec.ts', '**/fixtures/**'],
});`}
		/>
		<p>
			<code>sourceRoot</code> controls module-path stripping in <code>ModuleJson.path</code>: pass
			<code>'.'</code>
			for project-relative paths. <code>exclude</code> is the single source of truth, applied at both
			discovery and analysis time, so a file dropped here never shows up in the output regardless of how
			it was discovered.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Paths: POSIX-form contract" />
		<p>
			Every path stored, compared, or used as a Map/Set key inside the analyzer is POSIX form
			(forward slashes). Native paths are accepted at the public-API boundary and posixified at
			ingest, so Windows callers can hand in
			<code>C:\\repo\\src\\lib\\foo.ts</code> without thinking about it, but the resulting
			<code>ModuleJson.path</code>, <code>Diagnostic.file</code>, and session
			<code>list()</code> output report POSIX form.
		</p>
		<p>
			Out of scope: drive-letter case normalization (<code>C:\\</code> vs <code>c:\\</code>) and
			Windows extended-length <code>\\\\?\\</code> prefixes. See
			<ModuleLink module_path="paths.ts">paths.ts</ModuleLink> for the chokepoint implementation.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Concurrency caps" />
		<p>
			Two bounded-concurrency caps protect against runaway parallelism in the integration paths:
		</p>
		<ul>
			<li>
				<code>MAX_FILE_CONCURRENCY</code> caps parallel <code>readFile</code> calls (used by
				<code>files.globFiles</code>, <code>exports.discoverFromExports</code>).
			</li>
			<li>
				<code>MAX_RESOLVE_CONCURRENCY</code> caps parallel resolver calls (used by the session's phase-2
				lex+resolve pass).
			</li>
		</ul>
		<p>
			Same numerical value today, named separately for future independent tuning. Both run through a
			fail-fast, order-preserving worker pool (<code>map_concurrent</code> in
			<ModuleLink module_path="concurrency.ts">concurrency.ts</ModuleLink>).
		</p>
	</TomeSection>
</TomeContent>
