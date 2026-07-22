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
			Run in any directory with TypeScript or Svelte source files. Prints JSON describing your
			project's exports to stdout.
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
				Discovery defaults to <code>package.json</code> exports, falling back to glob.
				<code>-i</code> forces explicit patterns; <code>--discovery glob</code> skips exports;
				<code>--discovery exports</code> is strict (fails when exports is missing).
			</p>
			<p>
				<code>--source-dir</code> sets the source directory (default <code>src/lib</code>,
				repeatable for monorepos) and seeds the implicit include glob.
				<code>--source-root</code> controls module-path stripping in the output (defaults to the
				single <code>--source-dir</code> or their longest common prefix).
			</p>
			<p>Compact JSON pairs well with <code>jq</code>:</p>
			<Code
				lang="bash"
				content={`npx svelte-docinfo | jq '.modules | length'                  # count modules
npx svelte-docinfo | jq -r '.modules[].declarations[].name'  # list all exported names`}
			/>
			<p>
				JSON goes to stdout; info, warnings, and errors go to stderr, so the terminal interleaves
				them, but <code>&gt;</code> and <code>|</code> capture clean JSON.
				<code>-q</code>/<code>--quiet</code> silences info; warnings and errors still print.
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
						<td>include pattern (repeatable, replaces exports discovery)</td>
					</tr>
					<tr>
						<td class="white-space:nowrap"><code>-e, --exclude &lt;pattern&gt;</code></td>
						<td>
							exclude glob, applied at discovery and analysis (repeatable; fully replaces defaults,
							so it does not merge with <code>**/*.test.ts</code>, <code>**/*.spec.ts</code>)
						</td>
					</tr>
					<tr>
						<td class="white-space:nowrap"><code>-o, --output &lt;file&gt;</code></td>
						<td>
							output file (default: stdout; pass <code>-</code> for explicit stdout, so
							<code>-o "$OUT"</code> works when <code>$OUT=-</code>)
						</td>
					</tr>
					<tr>
						<td class="white-space:nowrap"><code>--discovery &lt;mode&gt;</code></td>
						<td>
							<code>auto</code> | <code>exports</code> | <code>glob</code> (default:
							<code>auto</code>: exports first, glob fallback). <code>exports</code> is strict and fails
							when package.json exports is missing.
						</td>
					</tr>
					<tr>
						<td class="white-space:nowrap"><code>--dist-dir &lt;dir&gt;</code></td>
						<td>dist directory for exports discovery (default: dist)</td>
					</tr>
					<tr>
						<td class="white-space:nowrap"><code>--source-dir &lt;dir&gt;</code></td>
						<td>
							source directory relative to project root (default: src/lib). Repeatable for
							monorepos; also seeds the implicit include glob.
						</td>
					</tr>
					<tr>
						<td class="white-space:nowrap"><code>--source-root &lt;dir&gt;</code></td>
						<td>
							source root for module-path stripping (default: single source-dir or longest common
							prefix)
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
							glob filter applied to module paths in output (repeatable). Full project is still
							analyzed (re-exports/dependents stay correct); diagnostics aren't filtered
						</td>
					</tr>
					<tr>
						<td><code>--no-resolve-dependencies</code></td>
						<td>disable dependency resolution</td>
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
				Exit codes: <strong>0</strong> success, <strong>1</strong> analysis errors,
				<strong>2</strong> CLI errors.
			</p>
		</TomeSection>

		<p>
			For SvelteKit and Vite projects where the analysis feeds into your app bundle, see the
			<TomeLink slug="vite-plugin">Vite plugin</TomeLink>.
		</p>
	</section>
</TomeContent>
