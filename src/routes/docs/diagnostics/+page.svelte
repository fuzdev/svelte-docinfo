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
			Analysis accumulates errors and warnings without halting, as an array of
			<DeclarationLink name="Diagnostic" /> entries alongside <code>modules</code> in the result.
			Identical diagnostics are reported once.
		</p>

		<TomeSection>
			<TomeSectionHeader text="Two-tier error model" />
			<p>
				<strong>Accumulated (non-fatal)</strong>: appended to the diagnostics array while analysis
				continues. Covers type resolution failures, member or prop extraction failures, and JSDoc
				tag misuse. The result is still valid (see <a href="#severity-vs-partial">partial</a>).
			</p>
			<p>
				<strong>Thrown (fatal)</strong>: setup-level problems throw from the public entry points:
			</p>
			<ul>
				<li>
					a missing or unloadable <code>tsconfig.json</code>: one that fails to parse, or an
					<code>extends</code> target that doesn't exist, like SvelteKit's generated tsconfig before
					<code>svelte-kit sync</code> has run
				</li>
				<li>Svelte older than 5</li>
				<li>
					invalid source options: empty <code>sourcePaths</code>, a path or absolute pattern outside
					<code>projectRoot</code>, or <code>sourcePaths</code> not under <code>sourceRoot</code>
				</li>
				<li>
					conflicting options: <code>discovery: 'exports'</code> with <code>include</code>, or
					<code>resolveImport</code> with <code>resolveDependencies: false</code>
				</li>
				<li>
					<code>discovery: 'exports'</code> when <code>exports</code> is missing or resolves to no
					files, or when the source paths share no common prefix
				</li>
				<li>a name collision under <code>onDuplicates: 'throw'</code></li>
			</ul>
			<p>
				Wrap <code>analyze</code> / <code>analyzeFromFiles</code>, or
				<code>createAnalysisSession</code> and <code>query</code>, to handle these. svelte2tsx
				failures don't throw; they surface as <code>transform_failed</code>.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Shape" />
			<p>
				<code>diagnostics</code> is a plain
				<code>Array&lt;<DeclarationLink name="Diagnostic" />&gt;</code> beside <code>modules</code>
				in <DeclarationLink name="AnalyzeResultJson" />. It round-trips through
				<code>JSON.stringify</code> and <DeclarationLink name="parseDiagnostics" />. Each entry
				carries:
			</p>
			<ul>
				<li><code>kind</code>: discriminant, one per failure mode (see table below)</li>
				<li><code>severity</code>: <code>"error"</code> or <code>"warning"</code></li>
				<li>
					<code>file</code>: POSIX-form and relative to the project root, with no leading
					<code>./</code>; a file outside the project takes the <code>../</code> form. Join with
					<code>projectRoot</code> to get the absolute path. It names a <em>file</em>, not a module:
					<code>ModuleJson.path</code> is relative to <code>sourceRoot</code>, so don't look modules
					up by <code>file</code>.
				</li>
				<li>
					<code>line</code>, <code>column</code>: 1-based, optional. Absent when there's no precise
					position (e.g., a module-level skip). Positions in Svelte files point at the original
					<code>.svelte</code> source; one that can't be mapped is omitted
				</li>
				<li>
					<code>message</code>: human-readable description, with project-root paths made relative
					like <code>file</code>
				</li>
				<li>
					fields specific to the kind: <code>symbolName</code>, <code>className</code>,
					<code>tagName</code>, etc.
				</li>
			</ul>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Diagnostic kinds" />
			<p>
				Severity is fixed per kind: every kind is a <code>warning</code> except
				<code>transform_failed</code> and <code>module_unreadable</code>, which are always
				<code>error</code>.
			</p>
			<p>
				The table below marks each kind's lifecycle. <strong>Ingest-time</strong> kinds surface when
				files are ingested and persist with the file until it is re-ingested or deleted,
				<strong>discovery-time</strong> comes from file discovery, and unmarked kinds are recomputed
				on every analysis pass. See the
				<TomeLink slug="session" hash="Diagnostics-ingest-time-vs-query-time">session</TomeLink>
				guide for how they combine.
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
							<strong>Trigger:</strong> type resolution threw on a declaration or member.
							<strong>Consequence:</strong> it's included with <code>partial: true</code>;
							<code>typeSignature</code> and <code>typeInfo</code> may be absent.
						</td>
					</tr>
					<tr>
						<td><code>signature_analysis_failed</code></td>
						<td>
							<strong>Trigger:</strong> function or method signature analysis threw.
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
							<strong>Trigger:</strong> a Svelte component prop type couldn't be resolved.
							<strong>Consequence:</strong> that prop's type falls back to <code>"any"</code>; if
							the whole props type on <code>$props()</code> is unresolvable, <code>props</code> is
							empty. When the check for a <code>children</code> snippet fails, only template use of
							<code>children</code> can set <code>acceptsChildren</code>. A legacy
							<code>export let</code> component whose svelte2tsx output has no recognized props type
							reports each exported prop, at its export's line, and has empty <code>props</code>.
						</td>
					</tr>
					<tr>
						<td><code>module_skipped</code></td>
						<td>
							<strong>Trigger:</strong> a whole module was skipped during analysis.
							<code>reason</code> is <code>"not_in_program"</code> (the file wasn't in the
							TypeScript program), <code>"no_analyzer"</code> (unsupported extension), or
							<code>"requires_program"</code> (a Svelte file passed to <code>analyzeModule</code>
							directly). <strong>Consequence:</strong> module absent from <code>modules[]</code>.
						</td>
					</tr>
					<tr>
						<td><code>module_unreadable</code></td>
						<td>
							<strong>Trigger:</strong> a file named by <code>package.json</code> exports couldn't
							be read (permission denied, FS error). <strong>Consequence:</strong> the file is
							dropped from the discovered set. <strong>Discovery-time.</strong>
						</td>
					</tr>
					<tr>
						<td><code>import_parse_failed</code></td>
						<td>
							<strong>Trigger:</strong> import scanning threw during dependency resolution (not
							expected: the parse tolerates malformed source). <strong>Consequence:</strong> the
							module's dependency edges are dropped; the module still analyzes.
							<strong>Ingest-time.</strong>
						</td>
					</tr>
					<tr>
						<td><code>duplicate_comment</code></td>
						<td>
							<strong>Trigger:</strong> two sources supplied a comment for the same target: an HTML
							<code>@component</code> comment plus script JSDoc
							(<code>commentType: "doc_comment"</code>), or several <code>@module</code> sources in
							a Svelte file (<code>"module_comment"</code>). <strong>Consequence:</strong> the
							higher-priority source wins: script JSDoc for doc comments; instance
							<code>&lt;script&gt;</code>, then <code>&lt;script module&gt;</code>, then HTML for
							module comments, skipping one that holds only dropped tags.
						</td>
					</tr>
					<tr>
						<td><code>component_comment_mismatch</code></td>
						<td>
							<strong>Trigger:</strong> svelte2tsx, and so editor hover, would document a component
							with a different HTML comment than the analyzer: it takes the last comment containing
							<code>@component</code> anywhere, the analyzer the first with <code>@component</code>
							at a line start. A second component comment or a passing mention (a backticked
							<code>@component</code> in a module comment) causes it. <strong>Consequence:</strong>
							the analyzer's pick documents the component, and <code>line</code> points at
							svelte2tsx's; reword that comment's <code>@component</code> so the two agree.
						</td>
					</tr>
					<tr>
						<td><code>misplaced_tag</code></td>
						<td>
							<strong>Trigger:</strong> a symbol-scope tag (<code>@example</code>,
							<code>@deprecated</code>, <code>@internal</code>, <code>@since</code>,
							<code>@see</code>, <code>@throws</code>, <code>@mutates</code>, <code>@default</code>,
							<code>@nodocs</code>) on a non-primary overload signature, or a tag that only
							describes a declaration (<code>@param</code>, <code>@returns</code>,
							<code>@mutates</code>, <code>@throws</code>, <code>@default</code>,
							<code>@nodocs</code>, <code>@cssprop</code>) in a <code>@module</code> comment (then
							<code>functionName</code> is absent), or a <code>@cssprop</code> on an exported
							declaration other than a component (<code>functionName</code> names it).
							<strong>Consequence:</strong> the tag is dropped. On an overload, move it to the
							primary signature; a <code>@cssprop</code> belongs in the component's doc comment. To
							omit a module, use <code>exclude</code> patterns rather than <code>@nodocs</code>.
							Overloads a member borrows through its type (<code>m: typeof fn</code>) never warn;
							the lending function's own analysis checks its tags.
						</td>
					</tr>
					<tr>
						<td><code>implementation_doc_hidden</code></td>
						<td>
							<strong>Trigger:</strong> an overloaded function, method, or constructor documents its
							implementation: a TS implementation's JSDoc, or in JS a block with no
							<code>@overload</code> tag beside the ones that have one, carrying prose or doc tags
							(a block of types alone doesn't fire). <strong>Consequence:</strong> the
							implementation's docs are hidden, as TypeScript's hover hides them, and an
							implementation <code>@nodocs</code> hides nothing. Move the docs to the first
							overload. <code>functionName</code> names the function.
						</td>
					</tr>
					<tr>
						<td><code>unknown_param</code></td>
						<td>
							<strong>Trigger:</strong> a <code>@param</code> key matches no parameter (a typo, or a
							stale doc after a rename). <strong>Consequence:</strong> the description is dropped.
						</td>
					</tr>
					<tr>
						<td><code>unknown_cssprop</code></td>
						<td>
							<strong>Trigger:</strong> a component's <code>@cssprop</code> names a property
							(<code>propertyName</code>) the component never reads through <code>var()</code>, in
							its <code>&lt;style&gt;</code> or its markup's static style text: a typo, a stale tag,
							or a property it leaves for its children. <code>line</code> is the tag's. Not emitted
							when the style isn't read (<code>css_parse_failed</code>,
							<code>css_lang_unsupported</code>). <strong>Consequence:</strong> none; the entry
							stays in <code>cssCustomProperties</code>, <code>documented: true</code>.
						</td>
					</tr>
					<tr>
						<td><code>alias_lost</code></td>
						<td>
							<strong>Trigger:</strong> TypeScript dropped the name of an exported type alias
							(<code>aliasName</code>) whose right-hand side is an indexed access or conditional,
							like <code>z.infer&lt;typeof S&gt;</code> or valibot's
							<code>v.InferOutput&lt;typeof S&gt;</code>, and svelte-docinfo can't
							<TomeLink slug="structured-types" hash="Lost-alias-names">recover it</TomeLink>.
							Literal-only unions (<code>z.enum</code>, <code>v.picklist</code>) and brand
							intersections don't warn, since they read fine expanded, and neither do
							<code>@nodocs</code> aliases. <strong>Consequence:</strong> unannotated positions
							document the alias's structure instead of its name. Where applicable, a nominal symbol
							(<code>interface Foo extends z.infer&lt;typeof S&gt; &#123;&#125;</code>) restores it.
						</td>
					</tr>
					<tr>
						<td><code>commonjs_unsupported</code></td>
						<td>
							<strong>Trigger:</strong> a JS module that TypeScript doesn't bind as a module (no
							<code>import</code>/<code>export</code> under
							<code>bundler</code>/<code>esnext</code>) exports through CommonJS
							(<code>module.exports = …</code>, <code>exports.x = …</code>), which isn't modeled.
							Under <code>node16</code>/<code>nodenext</code> or
							<code>moduleDetection: 'force'</code> the checker binds CommonJS exports itself, and
							its named exports (<code>exports.x</code>,
							<code>module.exports = {'{'}a, b{'}'}</code>) document without this warning; a
							<code>module.exports =</code> of a function or literal documents nothing.
							<strong>Consequence:</strong> the module is in <code>modules[]</code> with no
							declarations; its module comment still reads. Converting it to ES exports documents
							it.
						</td>
					</tr>
					<tr>
						<td><code>css_parse_failed</code></td>
						<td>
							<strong>Trigger:</strong> Svelte's parser rejects a component that has a
							<code>&lt;style&gt;</code>: malformed CSS, two top-level styles, or markup its loose
							parsing can't absorb. <strong>Consequence:</strong> the component emits without
							<code>cssCustomProperties</code> beyond its <code>@cssprop</code> tags;
							<code>line</code>/<code>column</code> are the parser's.
						</td>
					</tr>
					<tr>
						<td><code>css_lang_unsupported</code></td>
						<td>
							<strong>Trigger:</strong> a component's <code>&lt;style&gt;</code> names a
							preprocessor language (<code>lang="scss"</code>, <code>lang="postcss"</code>,
							<code>type="text/less"</code>), carried in <code>lang</code>.
							<strong>Consequence:</strong> the style isn't read, so the component emits without
							<code>cssCustomProperties</code> beyond its <code>@cssprop</code> tags.
						</td>
					</tr>
					<tr>
						<td><code>duplicate_declaration</code></td>
						<td>
							<strong>Trigger:</strong> a declaration name appears in more than one module, and the
							opt-in <code>onDuplicates</code> check is on (for packages with a flat export
							namespace). <code>declarationName</code> and <code>modules</code> name the conflict;
							<code>modules</code> holds <code>ModuleJson.path</code> values, unlike
							<code>file</code>. <strong>Consequence:</strong> none beyond the diagnostic, unless
							<code>onDuplicates</code> is <code>'warn'</code> (logs) or <code>'throw'</code>.
						</td>
					</tr>
					<tr>
						<td><code>transform_failed</code></td>
						<td>
							<strong>Trigger:</strong> svelte2tsx threw on a <code>.svelte</code> file.
							<strong>Consequence:</strong> the file's <DeclarationLink name="ModuleJson" /> is a
							placeholder (<code>partial: true</code>, empty <code>declarations</code>). Its default
							and namespace re-exports document as <code>partial</code> components or namespaces (a
							<code>&lt;script module&gt;</code> name stays a bare variable), and a star over it is
							one <DeclarationLink name="resolveExportSurface" /> reports unresolved.
							<strong>Ingest-time.</strong>
						</td>
					</tr>
					<tr>
						<td><code>source_map_failed</code></td>
						<td>
							<strong>Trigger:</strong> the source map svelte2tsx produced for a
							<code>.svelte</code> file couldn't be parsed. <strong>Consequence:</strong> analysis
							continues without position mapping: other diagnostics for the file omit
							<code>line</code>/<code>column</code>, and declaration <code>sourceLine</code>s point
							into the generated TypeScript. <strong>Ingest-time.</strong>
						</td>
					</tr>
					<tr>
						<td><code>resolver_failed</code></td>
						<td>
							<strong>Trigger:</strong> the import resolver threw on <code>specifier</code> (as
							opposed to returning <code>null</code> for an external). <strong>Consequence:</strong>
							the dependency edge is deferred and retried when a later <code>setFile</code> /
							<code>setFiles</code> adds files or the importer changes; the diagnostic clears once
							it resolves. <strong>Ingest-time.</strong>
						</td>
					</tr>
				</tbody>
			</table>
			<p>
				Use <DeclarationLink name="byKind" /> to narrow to one variant with typed fields:
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
				<code>severity</code> says how loud to be about a problem. <code>partial: true</code> says a
				declaration or member has incomplete data, from <code>type_extraction_failed</code>,
				<code>signature_analysis_failed</code>, or <code>class_member_failed</code>, and a
				<code>ModuleJson</code> is <code>partial</code> when it's a <code>transform_failed</code>
				placeholder. <code>svelte_prop_failed</code> sets no flag; the prop's type falls back to
				<code>any</code>. Check <code>partial</code> directly instead of matching diagnostics by
				file and line.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Helpers" />
			<p>Read helpers for the diagnostics array:</p>
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
			<p>
				See <ModuleLink module_path="diagnostics.ts">diagnostics.ts</ModuleLink> for the schemas and
				helpers.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Consuming diagnostics" />
			<p>
				The <TomeLink slug="cli">CLI</TomeLink> includes <code>diagnostics</code> in its JSON
				output, omitted when empty (<DeclarationLink name="parseAnalyzeResult" /> restores
				<code>[]</code>). Progress messages go to stderr; structured diagnostics appear only in the
				JSON:
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
				The <TomeLink slug="vite-plugin">Vite plugin</TomeLink>'s virtual module exports
				<code>diagnostics</code> too, so an app can render doc warnings without re-running analysis:
			</p>
			<Code
				lang="ts"
				content={`import {modules, diagnostics} from 'virtual:svelte-docinfo';
// the diagnostics subpath keeps the TypeScript compiler out of the client bundle
import {hasErrors} from 'svelte-docinfo/diagnostics.js';

if (hasErrors(diagnostics)) {
  // surface in the UI or fail the build
}`}
			/>
		</TomeSection>
	</section>
</TomeContent>
