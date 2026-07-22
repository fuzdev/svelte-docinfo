<script lang="ts">
	import Code from '@fuzdev/fuz_code/Code.svelte';
	import TomeContent from '@fuzdev/fuz_ui/TomeContent.svelte';
	import TomeSection from '@fuzdev/fuz_ui/TomeSection.svelte';
	import TomeSectionHeader from '@fuzdev/fuz_ui/TomeSectionHeader.svelte';
	import DeclarationLink from '@fuzdev/fuz_ui/DeclarationLink.svelte';
	import ModuleLink from '@fuzdev/fuz_ui/ModuleLink.svelte';
	import TomeLink from '@fuzdev/fuz_ui/TomeLink.svelte';
	import { tome_get_by_slug } from '@fuzdev/fuz_ui/tome.ts';

	const LIBRARY_ITEM_NAME = 'diagnostics';

	const tome = tome_get_by_slug(LIBRARY_ITEM_NAME);
</script>

<svelte:head>
	<title>diagnostics - svelte-docinfo</title>
</svelte:head>

<TomeContent {tome}>
	<section>
		<p>
			Analysis accumulates errors and warnings without halting. A failing declaration is marked
			<code>partial: true</code> and the rest of the module still analyzes. Detail lands in an array
			of <DeclarationLink name="Diagnostic" /> entries, alongside <code>modules</code> in the result.
		</p>

		<TomeSection>
			<TomeSectionHeader text="Two-tier error model" />
			<p>
				<strong>Accumulated (non-fatal)</strong>: appended to the
				<DeclarationLink name="Diagnostic" /> array, analysis continues. Covers type resolution failures,
				member or prop extraction failures, and JSDoc tag misuse. The return value is still valid but
				may carry <code>partial: true</code> on affected declarations.
			</p>
			<p>
				<strong>Thrown (fatal)</strong>: a small set of setup-level conditions throws from public
				entry points: missing <code>tsconfig.json</code>, Svelte &lt;5 detected, or
				<code>discovery: 'exports'</code> mode with no resolvable exports. Wrap the top-level
				<code>analyze</code> / <code>analyzeFromFiles</code> call if you want to handle these.
				svelte2tsx transformation failures are <em>not</em> thrown; they flow as
				<code>transform_failed</code> diagnostics.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Shape" />
			<p>
				<code>diagnostics</code> is a plain
				<code>Array&lt;<DeclarationLink name="Diagnostic" />&gt;</code>, no wrapper, no methods.
				Round-trips through <code>JSON.stringify</code> / <code>z.array(Diagnostic).parse</code>, so
				it serializes alongside <code>modules</code> in CLI output and rehydrates cleanly.
			</p>
			<Code
				lang="ts"
				content={`{
  modules: ModuleJson[],
  diagnostics: Diagnostic[]
}`}
			/>
			<p>
				Each <DeclarationLink name="Diagnostic" /> carries:
			</p>
			<ul>
				<li><code>kind</code>: discriminant, one per failure mode (see table below)</li>
				<li><code>severity</code>: <code>"error"</code> or <code>"warning"</code></li>
				<li>
					<code>file</code>: POSIX-form, project-relative (no leading <code>./</code>). Rejoin with
					<code>projectRoot</code> for absolute paths.
				</li>
				<li>
					<code>line</code>, <code>column</code>: 1-based, optional. Absent when there's no precise
					AST node (e.g., a module-level skip)
				</li>
				<li><code>message</code>: human-readable description</li>
				<li>
					additional fields specific to the variant: <code>symbolName</code>,
					<code>className</code>, <code>tagName</code>, etc.
				</li>
			</ul>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Diagnostic kinds" />
			<p>
				Severity is stable per kind: every kind below is <code>warning</code> severity except
				<code>transform_failed</code> and <code>module_unreadable</code>, which are always
				<code>error</code>.
			</p>
			<table>
				<thead>
					<tr>
						<th class="white-space:nowrap">kind</th>
						<th>When it fires</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td><code>type_extraction_failed</code></td>
						<td>
							<strong>Trigger:</strong> type resolution threw on a symbol.
							<strong>Consequence:</strong> declaration included with <code>partial: true</code> and
							empty <code>typeSignature</code>.
						</td>
					</tr>
					<tr>
						<td><code>signature_analysis_failed</code></td>
						<td>
							<strong>Trigger:</strong> function or method signature analysis threw, usually
							circular generics or unresolved call signatures.
							<strong>Consequence:</strong> declaration included with <code>partial: true</code>;
							parameters and overloads may be empty.
						</td>
					</tr>
					<tr>
						<td><code>class_member_failed</code></td>
						<td>
							<strong>Trigger:</strong> one member of a class couldn't be analyzed.
							<strong>Consequence:</strong> member included with <code>partial: true</code>;
							siblings still extract normally.
						</td>
					</tr>
					<tr>
						<td><code>svelte_prop_failed</code></td>
						<td>
							<strong>Trigger:</strong> a Svelte component prop type couldn't be resolved through
							the checker. <strong>Consequence:</strong> per-prop type resolution failures fall back
							to <code>"any"</code> for that prop with siblings unaffected; when the whole
							<code>$props&lt;T&gt;()</code> annotation type is itself unresolvable, the component's
							<code>props</code> array drops to empty.
						</td>
					</tr>
					<tr>
						<td><code>module_skipped</code></td>
						<td>
							<strong>Trigger:</strong> whole module skipped during the analysis pass.
							<code>reason</code> narrows to <code>"not_in_program"</code>,
							<code>"no_analyzer"</code>, or <code>"requires_program"</code>.
							<strong>Consequence:</strong> module absent from <code>modules[]</code>.
						</td>
					</tr>
					<tr>
						<td><code>module_unreadable</code></td>
						<td>
							<strong>Trigger:</strong> file named in <code>package.json</code> exports exists but
							<code>readFile</code> failed (permission denied, FS error).
							<strong>Consequence:</strong> file dropped from the discovered set.
							<strong>Discovery-time.</strong>
						</td>
					</tr>
					<tr>
						<td><code>import_parse_failed</code></td>
						<td>
							<strong>Trigger:</strong> import parsing failed during dependency resolution.
							<strong>Consequence:</strong> the dependency edge is dropped; the module itself still
							analyzes. <strong>Ingest-time.</strong>
						</td>
					</tr>
					<tr>
						<td><code>duplicate_comment</code></td>
						<td>
							<strong>Trigger:</strong> two sources supplied a comment for the same target (HTML
							<code>@component</code> + script JSDoc, or multiple <code>@module</code> comments).
							<code>commentType</code> narrows to <code>"module_comment"</code> or
							<code>"doc_comment"</code>. <strong>Consequence:</strong> the higher-priority source
							wins: JSDoc for doc comments; instance <code>&lt;script&gt;</code> &gt;
							<code>&lt;script module&gt;</code> &gt; HTML comment for module comments.
						</td>
					</tr>
					<tr>
						<td><code>misplaced_tag</code></td>
						<td>
							<strong>Trigger:</strong> symbol-scope tag (<code>@example</code>,
							<code>@deprecated</code>, <code>@since</code>, <code>@see</code>,
							<code>@throws</code>, <code>@mutates</code>, <code>@default</code>,
							<code>@nodocs</code>) found on a non-primary overload signature, or
							<code>@nodocs</code> in a <code>@module</code> comment (where it has no meaning;
							<code>functionName</code> is absent in that case).
							<strong>Consequence:</strong> the tag is dropped; move it to the primary signature —
							or, to omit a module from analysis, use <code>exclude</code> patterns.
						</td>
					</tr>
					<tr>
						<td><code>unknown_param</code></td>
						<td>
							<strong>Trigger:</strong> <code>@param</code> key didn't match any actual parameter
							(typo or stale doc after a rename). <strong>Consequence:</strong> the description is dropped.
						</td>
					</tr>
					<tr>
						<td><code>duplicate_declaration</code></td>
						<td>
							<strong>Trigger:</strong> a declaration name appears in more than one module, so the
							flat-namespace assumption collides. <code>declarationName</code> and
							<code>modules</code> name the conflict. <strong>Consequence:</strong> always emitted;
							<code>onDuplicates</code> only controls whether to additionally throw, log, or invoke a
							callback.
						</td>
					</tr>
					<tr>
						<td><code>transform_failed</code></td>
						<td>
							<strong>Trigger:</strong> svelte2tsx threw on a <code>.svelte</code> file.
							<strong>Consequence:</strong> the file's
							<DeclarationLink name="ModuleJson" /> is synthesized as a placeholder (<code
								>partial: true</code
							>, empty <code>declarations</code>).
							<strong>Ingest-time.</strong>
						</td>
					</tr>
					<tr>
						<td><code>source_map_failed</code></td>
						<td>
							<strong>Trigger:</strong> source map parsing failed for a Svelte virtual file.
							<strong>Consequence:</strong> analysis continues using virtual positions, so
							downstream <code>line</code>/<code>column</code> may point into the svelte2tsx output
							rather than the original <code>.svelte</code> source.
							<strong>Ingest-time.</strong>
						</td>
					</tr>
					<tr>
						<td><code>resolver_failed</code></td>
						<td>
							<strong>Trigger:</strong> import resolver threw on a specifier (vs. legitimately
							returning <code>null</code> for externals). <code>specifier</code> names the failing
							import. <strong>Consequence:</strong> the dependency edge is dropped.
							<strong>Ingest-time.</strong>
						</td>
					</tr>
				</tbody>
			</table>
			<p>
				Each variant is a strict Zod object with its own extra fields. Use
				<DeclarationLink name="byKind" /> to narrow to a specific variant for typed access:
			</p>
			<Code
				lang="ts"
				content={`import {byKind} from 'svelte-docinfo';

for (const d of byKind(diagnostics, 'misplaced_tag')) {
  // d.tagName, d.functionName, d.file, d.line are typed
  console.warn(\`\${d.functionName}: move @\${d.tagName} to the primary overload\`);
}`}
			/>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="severity vs partial" />
			<p>
				<code>severity</code> says how loud to be about a problem;
				<code>partial: true</code> says a specific declaration or member has incomplete data,
				typically from <code>type_extraction_failed</code>, <code>signature_analysis_failed</code>,
				<code>class_member_failed</code>, or <code>svelte_prop_failed</code>. Branch on
				<code>partial</code> directly; no need to cross-reference diagnostics by file and line.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Helpers" />
			<p>
				The diagnostics array is a plain
				<code>Array&lt;<DeclarationLink name="Diagnostic" />&gt;</code>: construct with
				<code>[]</code> and mutate with <code>Array.push</code>. Read helpers:
			</p>
			<ul>
				<li>
					<DeclarationLink name="hasErrors" />, <DeclarationLink name="hasWarnings" />: boolean
					checks by severity
				</li>
				<li>
					<DeclarationLink name="errorsOf" />, <DeclarationLink name="warningsOf" />: filter by
					severity
				</li>
				<li>
					<DeclarationLink name="byKind" />: filter by kind, narrowed to the matching variant
				</li>
				<li>
					<DeclarationLink name="formatDiagnostic" />: format as
					<code>'./file.ts:10:5: error: message'</code> (the <code>'./'</code> prefix is fixed)
				</li>
			</ul>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Consuming diagnostics" />
			<p>
				The <TomeLink slug="cli">CLI</TomeLink> emits the structured <code>diagnostics</code> field
				alongside <code>modules</code> in JSON output — stripped from the wire when empty, so parse
				through <DeclarationLink name="AnalyzeResultJson" /> to restore the default
				<code>[]</code>. Progress messages go to stderr; the structured diagnostics appear only in
				the JSON:
			</p>
			<Code
				lang="bash"
				content={`npx svelte-docinfo | jq '.diagnostics | group_by(.kind) | map({kind: .[0].kind, count: length})'`}
			/>
			<p>Programmatically:</p>
			<Code
				lang="ts"
				content={`import {analyzeFromFiles, errorsOf, formatDiagnostic, byKind} from 'svelte-docinfo';

const {modules, diagnostics} = await analyzeFromFiles({projectRoot: process.cwd()});

// File paths in diagnostics are already project-relative.
for (const d of errorsOf(diagnostics)) {
  console.error(formatDiagnostic(d));
}

// Specific check: any @param typos?
const stale = byKind(diagnostics, 'unknown_param');
if (stale.length) {
  console.warn(\`\${stale.length} stale @param tag(s); fix or remove\`);
}`}
			/>
			<p>
				The <TomeLink slug="vite-plugin">Vite plugin</TomeLink>'s virtual module exports both
				<code>modules</code> and <code>diagnostics</code>, so SvelteKit apps can render a
				doc-warnings page without re-running analysis:
			</p>
			<Code
				lang="ts"
				content={`import {modules, diagnostics} from 'virtual:svelte-docinfo';
import {hasErrors} from 'svelte-docinfo';

if (hasErrors(diagnostics)) {
  // surface in the UI or fail the build
}`}
			/>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Absence rule" />
			<p>
				Optional scalar fields (<code>line</code>, <code>column</code>) drop on serialize per the
				same compact-output rules as the rest of the schema. See <TomeLink slug="output-format" /> for
				the full rule. The Vite plugin's virtual module exposes <code>modules</code> and
				<code>diagnostics</code> as separate ES module exports, so they're always present even when
				empty. See <ModuleLink module_path="diagnostics.ts">diagnostics.ts</ModuleLink> for the Zod schemas
				and helper signatures.
			</p>
		</TomeSection>
	</section>
</TomeContent>
