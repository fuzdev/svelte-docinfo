<script lang="ts">
	import Code from '@fuzdev/fuz_code/Code.svelte';
	import TomeContent from '@fuzdev/fuz_ui/TomeContent.svelte';
	import TomeSection from '@fuzdev/fuz_ui/TomeSection.svelte';
	import TomeSectionHeader from '@fuzdev/fuz_ui/TomeSectionHeader.svelte';
	import TomeLink from '@fuzdev/fuz_ui/TomeLink.svelte';
	import DeclarationLink from '@fuzdev/fuz_ui/DeclarationLink.svelte';
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
			its root (or pass <code>--no-tsconfig</code>). The CLI runs
			<DeclarationLink name="analyzeFromFiles" /> once and prints the JSON to stdout.
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
				It documents the files <code>package.json</code> <code>exports</code> point to, falling back
				to everything under <code>src/lib</code>; <TomeLink slug="source-files" /> covers the flags
				that change that.
			</p>
			<p>
				Output is <TomeLink slug="output-format" hash="Compact-JSON">compact</TomeLink>: empty
				arrays and <code>false</code> flags are omitted, so treat absent as empty, or parse with
				<DeclarationLink name="parseAnalyzeResult" />. It pairs well with <code>jq</code>:
			</p>
			<Code
				lang="bash"
				content={`npx svelte-docinfo | jq '.modules | length'                  # count modules
npx svelte-docinfo | jq -r '.modules[].declarations[].name'  # list all exported names`}
			/>
			<p>
				JSON goes to stdout and messages go to stderr, so <Code lang="bash" inline content={'>'} />
				and <Code lang="bash" inline content="|" /> capture clean JSON. <code>-q</code> silences
				info messages; warnings and errors still print.
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
							<code>{'**/*.{test,spec}.{ts,mts,tsx,js,mjs,jsx}'}</code>, <code>**/internal/**</code>
							entirely
						</td>
					</tr>
					<tr>
						<td class="white-space:nowrap"><code>-o, --output &lt;file&gt;</code></td>
						<td>
							output file (default: stdout; <code>-</code> also means stdout, so
							<Code lang="bash" inline content={'-o "$OUT"'} /> works when <code>$OUT=-</code>)
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
						<td class="white-space:nowrap"><code>--tsconfig &lt;path&gt;</code></td>
						<td>
							path to the tsconfig, relative to the project root and searched upward from it
							(default: <code>tsconfig.json</code>)
						</td>
					</tr>
					<tr>
						<td><code>--no-tsconfig</code></td>
						<td>analyze without a tsconfig, using built-in strict compiler options</td>
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
						<td class="white-space:nowrap"><code>--on-duplicates &lt;mode&gt;</code></td>
						<td>
							opt-in check that names are unique across modules, for packages with a flat export
							namespace: <code>diagnostic</code> | <code>warn</code> | <code>throw</code> (default:
							off)
						</td>
					</tr>
					<tr>
						<td><code>-V, --version</code></td>
						<td>show version number</td>
					</tr>
					<tr>
						<td><code>-h, --help</code></td>
						<td>show help</td>
					</tr>
				</tbody>
			</table>
			<p>
				<code>--include</code>, <code>--exclude</code>, <code>--source-dir</code>, and the discovery
				and tsconfig flags work as <TomeLink slug="source-files" /> describes.
				<code>--exclude</code> always replaces the defaults; there's no form that extends them.
			</p>
			<p>
				Exit codes: <strong>0</strong> success, <strong>1</strong> analysis errors,
				<strong>2</strong> CLI errors (an unknown flag, a missing or invalid option value) or a
				thrown analysis error (a missing or unloadable <code>tsconfig.json</code>, strict exports
				discovery failing).
			</p>
		</TomeSection>

		<p>
			To use the data in a SvelteKit or Vite app, see the
			<TomeLink slug="vite-plugin">Vite plugin</TomeLink>; from code, the
			<TomeLink slug="js-api">JS API</TomeLink>.
		</p>
	</section>
</TomeContent>
