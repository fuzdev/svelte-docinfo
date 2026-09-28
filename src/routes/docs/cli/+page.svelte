<script lang="ts">
	import Code from '@fuzdev/fuz_code/Code.svelte';
	import TomeContent from '@fuzdev/fuz_ui/TomeContent.svelte';
	import TomeSection from '@fuzdev/fuz_ui/TomeSection.svelte';
	import TomeSectionHeader from '@fuzdev/fuz_ui/TomeSectionHeader.svelte';
	import TomeLink from '@fuzdev/fuz_ui/TomeLink.svelte';
	import { tome_get_by_slug } from '@fuzdev/fuz_ui/tome.ts';

	const LIBRARY_ITEM_NAME = 'cli';

	const tome = tome_get_by_slug(LIBRARY_ITEM_NAME);
</script>

<svelte:head>
	<title>CLI - svelte-docinfo</title>
</svelte:head>

<TomeContent {tome}>
	<section>
		<p>
			Run in a project with TypeScript or Svelte source and a <code>tsconfig.json</code> at or above
			its root. The CLI prints JSON describing the project's exports to stdout.
		</p>

		<TomeSection>
			<TomeSectionHeader text="Basic usage" />
			<Code
				lang="bash"
				content={`npx svelte-docinfo                    # analyze the current directory
npx svelte-docinfo ./packages/my-lib  # analyze a specific directory
npx svelte-docinfo -o output.json     # write to a file instead
npx svelte-docinfo --pretty           # pretty-print the JSON output`}
			/>
			<p>
				Files are discovered from <code>package.json</code> exports, falling back to glob.
				<code>-i</code> supplies explicit patterns, <code>--discovery glob</code> skips exports, and
				<code>--discovery exports</code> fails when exports is missing or resolves to no files.
			</p>
			<p>
				<code>--source-dir</code> sets the source directory (default <code>src/lib</code>,
				repeatable for monorepos). <code>--source-root</code> sets the base of output module paths
				(default: the single source dir, or the longest common prefix of several).
			</p>
			<p>Compact JSON pairs well with <code>jq</code>:</p>
			<Code
				lang="bash"
				content={`npx svelte-docinfo | jq '.modules | length'                  # count modules
npx svelte-docinfo | jq -r '.modules[].declarations[].name'  # list all exported names`}
			/>
			<p>
				JSON goes to stdout and messages go to stderr, so <code>&gt;</code> and <code>|</code>
				capture clean JSON. <code>-q</code> silences info messages; warnings and errors still print.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Options" />
			<table>
				<thead>
					<tr>
						<th class="white-space:nowrap">Flag</th>
						<th>Description</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td><code>[project-root]</code></td>
						<td>project root directory (default: cwd)</td>
					</tr>
					<tr>
						<td class="white-space:nowrap"><code>-i, --include &lt;pattern&gt;</code></td>
						<td>
							include pattern (repeatable). Replaces exports discovery and widens the source scope
							(see below); incompatible with <code>--discovery exports</code>
						</td>
					</tr>
					<tr>
						<td class="white-space:nowrap"><code>-e, --exclude &lt;pattern&gt;</code></td>
						<td>
							exclude glob, applied at discovery and analysis (repeatable). Replaces the defaults
							<code>**/*.test.ts</code>, <code>**/*.spec.ts</code>, <code>**/internal/**</code>
							entirely
						</td>
					</tr>
					<tr>
						<td class="white-space:nowrap"><code>-o, --output &lt;file&gt;</code></td>
						<td>
							output file (default: stdout; <code>-</code> also means stdout, so
							<code>-o "$OUT"</code> works when <code>$OUT=-</code>)
						</td>
					</tr>
					<tr>
						<td class="white-space:nowrap"><code>--discovery &lt;mode&gt;</code></td>
						<td>
							<code>auto</code> | <code>exports</code> | <code>glob</code> (default:
							<code>auto</code>: exports first, glob fallback). <code>exports</code> fails when
							package.json exports is missing or resolves to no files
						</td>
					</tr>
					<tr>
						<td class="white-space:nowrap"><code>--dist-dir &lt;dir&gt;</code></td>
						<td>dist directory for exports discovery (default: dist)</td>
					</tr>
					<tr>
						<td class="white-space:nowrap"><code>--source-dir &lt;dir&gt;</code></td>
						<td>
							source directory, relative to the project root or absolute inside it (default:
							src/lib). Repeatable; also sets the default include glob
						</td>
					</tr>
					<tr>
						<td class="white-space:nowrap"><code>--source-root &lt;dir&gt;</code></td>
						<td>
							base of output module paths (default: single source dir or longest common prefix;
							<code>.</code> for project-relative)
						</td>
					</tr>
					<tr>
						<td class="white-space:nowrap"><code>--on-duplicates &lt;mode&gt;</code></td>
						<td>
							dispatch on duplicate declaration names: <code>throw</code> | <code>warn</code>
							(default: emit <code>duplicate_declaration</code> diagnostic, no dispatch)
						</td>
					</tr>
					<tr>
						<td class="white-space:nowrap"><code>--only &lt;pattern&gt;</code></td>
						<td>
							glob filter on output module paths (repeatable). The full project is still analyzed,
							so re-exports and dependents stay correct; diagnostics aren't filtered
						</td>
					</tr>
					<tr>
						<td><code>--no-resolve-dependencies</code></td>
						<td>
							disable dependency resolution (<code>dependencies</code>/<code>dependents</code> stay
							empty)
						</td>
					</tr>
					<tr>
						<td><code>--pretty</code></td>
						<td>pretty-print JSON output (default: compact)</td>
					</tr>
					<tr>
						<td><code>-q, --quiet</code></td>
						<td>suppress info messages on stderr (warnings and errors still print)</td>
					</tr>
					<tr>
						<td><code>-V, --version</code></td>
						<td>show version number</td>
					</tr>
				</tbody>
			</table>
			<p>
				<code>--include</code> patterns widen the source scope: each pattern's static base joins the
				source dirs, and module paths become relative to the widened root. A pattern with no base
				(<code>**/*.ts</code>, a root file) makes the whole project root source and logs an info
				line.
			</p>
			<p>
				Regardless of <code>--exclude</code>, <code>node_modules</code> and dot-directories below a
				source dir are never source. The default excludes cover tests and the
				<code>src/lib/internal/</code> convention (<code>**/internal/**</code>). Exports discovery
				also skips subpaths blocked by <code>null</code> exports entries
				(<code>"./internal/*": null</code>), using Node's best-match rules.
			</p>
			<p>
				Absolute paths and patterns inside the project root are accepted; ones outside it are an
				error.
			</p>
			<p>
				Exit codes: <strong>0</strong> success, <strong>1</strong> analysis errors,
				<strong>2</strong> CLI errors or a thrown analysis error (missing
				<code>tsconfig.json</code>, an <code>--on-duplicates throw</code> collision, strict exports
				discovery failing).
			</p>
		</TomeSection>

		<p>
			For SvelteKit and Vite projects where the analysis feeds into your app bundle, see the
			<TomeLink slug="vite-plugin">Vite plugin</TomeLink>.
		</p>
	</section>
</TomeContent>
