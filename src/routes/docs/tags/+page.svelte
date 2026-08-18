<script lang="ts">
	import Code from '@fuzdev/fuz_code/Code.svelte';
	import TomeContent from '@fuzdev/fuz_ui/TomeContent.svelte';
	import TomeSection from '@fuzdev/fuz_ui/TomeSection.svelte';
	import TomeSectionHeader from '@fuzdev/fuz_ui/TomeSectionHeader.svelte';
	import DeclarationLink from '@fuzdev/fuz_ui/DeclarationLink.svelte';
	import ModuleLink from '@fuzdev/fuz_ui/ModuleLink.svelte';
	import TomeLink from '@fuzdev/fuz_ui/TomeLink.svelte';
	import { tome_get_by_slug } from '@fuzdev/fuz_ui/tome.ts';

	const LIBRARY_ITEM_NAME = 'tags';

	const tome = tome_get_by_slug(LIBRARY_ITEM_NAME);
</script>

<svelte:head>
	<title>tags - svelte-docinfo</title>
</svelte:head>

<TomeContent {tome}>
	<section>
		<p>
			svelte-docinfo extracts TSDoc/JSDoc tags from source comments and surfaces them as structured
			fields on the <TomeLink slug="output-format">output</TomeLink>. This page lists every tag that
			is parsed, where its value lands, and the rules that decide which symbol receives it. The set
			is the common doc tags of <a href="https://jsdoc.app/">JSDoc</a> and the
			<a href="https://tsdoc.org/">TSDoc spec</a> as used across the TypeScript ecosystem — where
			the two standards spell a tag differently (JSDoc <code>@default</code> vs TSDoc
			<code>@defaultValue</code>, JSDoc's <code>@return</code> synonym vs <code>@returns</code>),
			both spellings are accepted — plus the custom tags <code>@nodocs</code> and
			<code>@mutates</code>. Inline tags like <code>{`{@link}`}</code> are not processed: they stay verbatim
			in the extracted text, and rendering them is the consumer's concern. Please submit issues if it's
			missing something you need or if any tags are off-spec.
		</p>

		<TomeSection>
			<TomeSectionHeader text="Supported tags" />
			<table>
				<thead>
					<tr>
						<th class="white-space:nowrap">Tag</th>
						<th>Where it lands</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td><code>@param</code></td>
						<td>
							<DeclarationLink name="ParameterJson" />.<code>description</code> on the matching
							parameter. Dotted keys (<code>obj.prop</code>) land in
							<code>propertyDescriptions</code>. Keys matching no parameter emit
							<code>unknown_param</code>
						</td>
					</tr>
					<tr>
						<td><code>@returns</code></td>
						<td>
							<code>returnDescription</code> on functions, function members, and per-overload
							<DeclarationLink name="OverloadJson" />. <code>@return</code> (JSDoc synonym) parses identically
						</td>
					</tr>
					<tr>
						<td><code>@throws</code></td>
						<td>
							<code>throws</code> array on the parent declaration. <code>{`{Type}`}</code> hints are extracted
							as the leading error type
						</td>
					</tr>
					<tr>
						<td><code>@example</code></td>
						<td><code>examples</code> array on the parent declaration</td>
					</tr>
					<tr>
						<td><code>@deprecated</code></td>
						<td>
							<code>deprecatedMessage</code> on the parent declaration. Empty body still marks the symbol
							deprecated
						</td>
					</tr>
					<tr>
						<td><code>@internal</code></td>
						<td>
							<code>internalMessage</code> on the parent declaration or member. A marker, not an exclusion
							— the declaration stays documented; trailing prose is kept, and an empty body still marks
							the symbol internal
						</td>
					</tr>
					<tr>
						<td><code>@see</code></td>
						<td>
							<code>seeAlso</code> array. Plain URLs, <code>{`{@link}`}</code> syntax, and module names
							all preserved in their source form
						</td>
					</tr>
					<tr>
						<td><code>@since</code></td>
						<td><code>since</code> string on the parent declaration</td>
					</tr>
					<tr>
						<td><code>@default</code></td>
						<td>
							<code>defaultValue</code> on variable declarations and on members of both kinds — for
							a function member it documents the behavior used when the callback is omitted; falls
							back for <DeclarationLink name="ComponentPropJson" />.<code>defaultValue</code> when
							no destructuring default is present. Never lands on top-level function declarations or
							overloads. <code>@defaultValue</code> (TSDoc spelling) and
							<code>@defaultvalue</code> (JSDoc synonym) parse identically
						</td>
					</tr>
					<tr>
						<td><code>@mutates</code></td>
						<td>
							Non-standard tag for documenting mutations to parameters or external state:
							<code>@mutates target - description</code>, splitting at the first
							<code>-</code> separator so the target can be a compound path or multi-word phrase
						</td>
					</tr>
					<tr>
						<td><code>@nodocs</code></td>
						<td>
							Non-standard tag that excludes the declaration from output entirely; also excludes it
							from flat-namespace duplicate checking. Declaration- and statement-level only — in a
							<code>@module</code> comment it has no effect and warns
						</td>
					</tr>
					<tr>
						<td><code>@module</code></td>
						<td>
							Promotes the comment to <DeclarationLink name="ModuleJson" />.<code
								>moduleComment</code
							> instead of attaching to a declaration
						</td>
					</tr>
				</tbody>
			</table>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Symbol-scope vs signature-scope" />
			<p>Two tags vary per overload signature; the rest describe the symbol as a whole.</p>
			<ul>
				<li>
					<strong>Signature-scope</strong>: <code>@param</code> and <code>@returns</code>. These
					flow to the matching overload's <code>parameters[i].description</code> /
					<code>returnDescription</code>. Each overload can carry its own.
				</li>
				<li>
					<strong>Symbol-scope</strong>: <code>@example</code>, <code>@deprecated</code>,
					<code>@internal</code>, <code>@since</code>, <code>@see</code>, <code>@throws</code>,
					<code>@mutates</code>, <code>@default</code>, <code>@nodocs</code>. These describe the
					symbol as a whole and live on the parent declaration only.
				</li>
			</ul>
			<p>
				Placing a symbol-scope tag on a non-primary overload emits
				<code>misplaced_tag</code> and the tag is dropped, with no synthetic content and no silent
				loss. Move it to the primary signature (typically the first overload, or the implementation
				signature's JSDoc which feeds the symbol-level extraction). See
				<TomeLink slug="diagnostics" /> for the diagnostic details.
			</p>
			<Code
				lang="ts"
				content={`/**
 * @example double(2) // 4
 * @deprecated use \`scale\` instead
 */
export function double(n: number): number;
export function double(n: bigint): bigint;
export function double(n: number | bigint): number | bigint {
  return (n as any) * 2;
}`}
			/>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="@param matching and unknown_param" />
			<p>
				<code>@param</code> keys are matched against actual parameter names. The leading
				<code>-</code> separator is stripped (TypeScript's parser keeps it as syntax, not content).
				A bare key matches the parameter name; a dotted key (<code>obj.prop</code>) documents a
				property of a named object parameter.
			</p>
			<p>
				Dotted keys whose root segment is a real parameter (<code>obj</code> in
				<code>obj.prop</code>) land in <DeclarationLink name="ParameterJson" />'s
				<code>propertyDescriptions</code> record, keyed by the sub-path (<code>obj.prop</code> →
				<code>prop</code>, <code>obj.a.b</code> → <code>a.b</code>). The property segment is not
				validated against the parameter's type. Matching is by parameter name, so destructured
				parameters (<code>{`fn({a, b}: T)`}</code>, which TypeScript names <code>__0</code>) are not
				covered.
			</p>
			<p>
				A key matching no parameter — or a dotted key whose root segment matches none — drops its
				description and fires an <code>unknown_param</code> diagnostic with the orphaned key, usually
				a typo or stale doc after a rename. Fix the JSDoc rather than relying on the silent fallback.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="@mutates" />
			<p>
				Non-standard tag for documenting mutations to parameters or external state, in the form
				<code>@mutates target - description</code>. The target is everything before the first
				<code>-</code> separator — unlike <code>@param</code> it isn't restricted to a single
				identifier — and targets are <strong>not validated</strong> against the parameter list.
				Backticks are stripped from the target, so <code>`options`</code> and
				<code>options</code> are the same key. Anything goes:
			</p>
			<ul>
				<li>
					a parameter name: <code>@mutates options - sets defaults in place</code>
				</li>
				<li>
					a compound path: <code>@mutates this.cache - inserts the result</code>
				</li>
				<li>
					a multi-word external reference:
					<code>@mutates `app_settings` row - bumps the revision</code>
				</li>
				<li>
					a bare target with no description: <code>@mutates `this`</code>
				</li>
			</ul>
			<p>
				The output is a <code>Record&lt;string, string&gt;</code> mapping each target to its description
				— empty for the bare form. Without a separator the first line is the target and any continuation
				lines are the description. Consumers decide how to render or group by key shape.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="@internal" />
			<p>
				<code>@internal</code> marks a symbol as "not stable public API" per TSDoc semantics,
				landing as <code>internalMessage</code> on declarations and members of every kind. Presence
				means the tag was written — a bare tag yields an empty string, and trailing prose (common in
				JSDoc corpora: <code>@internal used during development</code>) is kept as the field's value,
				separate from <code>docComment</code>.
			</p>
			<p>
				It is a <strong>marker, not an exclusion</strong>: the declaration remains fully documented,
				so consumers can render a badge or filter as they see fit. To remove a declaration from
				output entirely, use <code>@nodocs</code>; to omit whole modules, use
				<code>exclude</code> patterns.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="@nodocs" />
			<p>
				<code>@nodocs</code> on a declaration removes it from the analysis output entirely. Two follow-on
				effects:
			</p>
			<ul>
				<li>
					<strong>Flat-namespace duplicate checking skips it</strong>: a hidden helper named
					<code>parse</code> can coexist with a public <code>parse</code> in another module without
					triggering <code>duplicate_declaration</code>.
				</li>
				<li>
					<strong>Re-export synthesis is suppressed</strong>: <code>@nodocs</code> on a re-export
					statement drops both the <code>alsoExportedFrom</code> link and any synthesized alias declaration.
					The canonical entry stays untouched.
				</li>
				<li>
					<strong>Merged value+type pairs honor it from either side</strong>: a
					<code>const Foo</code> + <code>type Foo</code> pair is one merged symbol, so the tag on either
					declaration excludes the pair's single declaration.
				</li>
			</ul>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="@module" />
			<p>
				A comment tagged <code>@module</code> attaches to the file rather than to the next
				declaration. The text lands on <code>ModuleJson.moduleComment</code> and is suppressed from
				any declaration <code>docComment</code> that might otherwise capture it.
			</p>
			<Code
				lang="ts"
				content={`/**
 * Date math utilities.
 *
 * @module
 */

export function add_days(d: Date, n: number): Date { /* ... */ }`}
			/>
			<p>
				Svelte files have a second module-comment source: an HTML comment directly above
				<code>&lt;script&gt;</code>. When both an HTML and a JSDoc <code>@module</code> comment
				supply a value for the same target, <code>duplicate_comment</code> fires with
				<code>commentType: "module_comment"</code>. The same diagnostic covers declaration-level
				collisions (<code>commentType: "doc_comment"</code>).
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Re-exports inherit comments selectively" />
			<p>
				A re-export that carries its own JSDoc synthesizes an alias in the re-exporting module so
				the local content has somewhere to live, even when the name is unchanged. See
				<TomeLink slug="output-format">Re-exports</TomeLink> for the full encoding rules and merge order.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Tag-related diagnostics" />
			<p>Three diagnostic kinds surface tag-handling problems:</p>
			<ul>
				<li>
					<code>misplaced_tag</code>: symbol-scope tag on a non-primary overload signature, or
					<code>@nodocs</code> in a <code>@module</code> comment (no module-level meaning — use
					<code>exclude</code> patterns to omit a module)
				</li>
				<li>
					<code>unknown_param</code>: <code>@param</code> key with no matching parameter
				</li>
				<li>
					<code>duplicate_comment</code>: two sources supplied a comment for the same target (HTML +
					JSDoc <code>@module</code>, or any other collision)
				</li>
			</ul>
			<p>
				All three are warnings; analysis still completes and the declaration is included. See
				<ModuleLink module_path="tsdoc.ts">tsdoc.ts</ModuleLink> for the parser internals and
				<TomeLink slug="diagnostics" /> for the full diagnostic schema.
			</p>
		</TomeSection>
	</section>
</TomeContent>
