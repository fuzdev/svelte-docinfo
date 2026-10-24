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
			svelte-docinfo extracts TSDoc/JSDoc tags from source comments into structured fields on the
			<TomeLink slug="output-format">output</TomeLink>. This page lists every parsed tag, where its
			value lands, and which symbol receives it.
		</p>
		<p>
			The set is the common tags of <a href="https://jsdoc.app/">JSDoc</a> and the
			<a href="https://tsdoc.org/">TSDoc spec</a>, plus the custom <code>@nodocs</code> and
			<code>@mutates</code>, and the Custom Elements Manifest's <code>@cssprop</code> for a
			component's CSS custom properties. Where the standards spell a tag differently, both spellings
			work (<code>@default</code> / <code>@defaultValue</code>, <code>@return</code> /
			<code>@returns</code>, <code>@cssprop</code> / <code>@cssproperty</code>).
		</p>
		<p>
			Inline tags like <code>{`{@link}`}</code> are kept in the extracted text for the consumer to
			render. TypeScript reprints <code>{`{@link A|b}`}</code> as <code>{`{@link A |b}`}</code>;
			<code>@see</code> keeps its source text exactly. Please open an issue if a tag you need is
			missing or off-spec.
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
							<DeclarationLink name="OverloadJson" />. <code>@return</code> (JSDoc synonym) parses
							identically
						</td>
					</tr>
					<tr>
						<td><code>@throws</code></td>
						<td>
							<code>throws</code> array on the parent declaration. A braced type
							(<code>{`@throws {TypeError} - description`}</code>, unions included) lands in
							<code>type</code>; the description may be empty or multiline. Without braces the first
							word is the type (<code>@throws TypeError if …</code>), so <code>@throws if …</code>
							records <code>if</code> as the type. A lone unbraced word is the description
						</td>
					</tr>
					<tr>
						<td><code>@example</code></td>
						<td><code>examples</code> array on the parent declaration</td>
					</tr>
					<tr>
						<td><code>@deprecated</code></td>
						<td>
							<code>deprecatedMessage</code> on the parent declaration. An empty body still marks
							the symbol deprecated
						</td>
					</tr>
					<tr>
						<td><code>@internal</code></td>
						<td>
							<code>internalMessage</code> on the parent declaration, member, or component prop. A
							marker, not an exclusion (see <a href="#internal">@internal</a>)
						</td>
					</tr>
					<tr>
						<td><code>@see</code></td>
						<td>
							<code>seeAlso</code> array, each entry in its source form (URLs,
							<code>{`{@link}`}</code>, module names)
						</td>
					</tr>
					<tr>
						<td><code>@since</code></td>
						<td><code>since</code> string on the parent declaration</td>
					</tr>
					<tr>
						<td><code>@default</code></td>
						<td>
							<code>defaultValue</code> on variable declarations and on variable and function
							members (for a function member, the behavior when the callback is omitted). Also fills
							<DeclarationLink name="ComponentPropJson" />.<code>defaultValue</code> when the prop
							has no destructuring default. Never on top-level functions, overloads, or
							constructors. <code>@defaultValue</code> and <code>@defaultvalue</code> parse
							identically
						</td>
					</tr>
					<tr>
						<td><code>@mutates</code></td>
						<td>
							<code>mutates</code> record of target to description (see
							<a href="#mutates">@mutates</a>)
						</td>
					</tr>
					<tr>
						<td><code>@nodocs</code></td>
						<td>
							Excludes the declaration from output and from the opt-in duplicate-name check (see
							<a href="#nodocs">@nodocs</a>). Applies to declarations and export statements only: in
							a <code>@module</code> comment it warns <code>misplaced_tag</code> and is dropped, and
							on a member or component prop it silently does nothing
						</td>
					</tr>
					<tr>
						<td><code>@cssprop</code></td>
						<td>
							A Svelte component's CSS custom property, in
							<DeclarationLink name="ComponentDeclarationJson" />.<code>cssCustomProperties</code>
							(see <a href="#cssprop">@cssprop</a>). Read from the component's doc comment only; on
							any other declaration or in a <code>@module</code> comment it warns
							<code>misplaced_tag</code> and is dropped. <code>@cssproperty</code> parses
							identically
						</td>
					</tr>
					<tr>
						<td><code>@module</code></td>
						<td>
							Makes the comment document the file: its prose becomes
							<DeclarationLink name="ModuleJson" />.<code>moduleComment</code> and its tags the
							module's own fields, instead of a declaration's doc (see
							<a href="#module">@module</a>)
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
				A symbol-scope tag on a non-primary overload emits <code>misplaced_tag</code> and is
				dropped. Put these tags on the first overload signature: its JSDoc documents the symbol,
				while JSDoc on a later overload documents only that overload.
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
			<TomeSectionHeader text="@overload blocks" />
			<p>
				In JS, each <code>@overload</code> tag declares a signature, and its JSDoc is the block the
				tag sits in, with the <code>@param</code> and <code>@returns</code> tags that follow it. The
				first overload documents the function, as the first signature does in TS. The
				implementation's own block is hidden with its signature, as TypeScript reads it, so put the
				function's prose and symbol-scope tags on the first <code>@overload</code> block, not on the
				implementation's; a documented implementation warns <code>implementation_doc_hidden</code>,
				in TS too. Write <code>@template</code> before <code>@overload</code>: TypeScript rejects
				one between <code>@overload</code> and its <code>@param</code>/<code>@returns</code> tags.
			</p>
			<Code
				lang="js"
				content={`/**
 * Doubles a number or a bigint.
 * @overload
 * @param {number} n - the number to double
 * @returns {number}
 * @example double(2) // 4
 */
/**
 * @overload
 * @param {bigint} n - the bigint to double
 * @returns {bigint}
 */
/** @param {number | bigint} n */
export function double(n) {
  return /** @type {any} */ (n) * 2;
}`}
			/>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="@typedef blocks" />
			<p>
				In JS, a block that declares a <code>@typedef</code> or <code>@callback</code> and has no
				<code>@param</code> or <code>@returns</code> of its own documents the typedef, not the
				declaration below it, as TypeScript's hover reads it. A <code>@module</code> block keeps its
				prose for the module, and a component's JSDoc above <code>$props()</code> for the component;
				the typedef gets no prose of its own. A <code>@typedef</code> in a component's HTML
				<code>@component</code> comment documents nothing. Declare a component's props typedef in
				its own block, and put the prose on the <code>@type</code> block above
				<code>$props()</code>: svelte2tsx copies that block into its generated code, so svelte-check
				reports a typedef there as a duplicate identifier.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="@param matching and unknown_param" />
			<p>
				<code>@param</code> keys are matched against parameter names, and the leading <code>-</code>
				separator is stripped from the description. A dotted key (<code>obj.prop</code>) documents a
				property of a named object parameter.
			</p>
			<p>
				Dotted keys land in <DeclarationLink name="ParameterJson" />'s
				<code>propertyDescriptions</code>, keyed by sub-path (<code>obj.prop</code> →
				<code>prop</code>, <code>obj.a.b</code> → <code>a.b</code>). The property path isn't checked
				against the parameter's type. Destructured parameters (<code>{`fn({a, b}: T)`}</code>, which
				TypeScript names <code>__0</code>) can't be matched by name, so they aren't covered.
			</p>
			<p>
				A key whose name (or dotted root) matches no parameter drops its description and emits
				<code>unknown_param</code> with the key, usually a typo or a stale doc after a rename.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="@mutates" />
			<p>
				A non-standard tag for documenting mutations to parameters or external state:
				<code>@mutates target - description</code>. The target is everything before the first
				<code>{` - `}</code> (space-hyphen-space), so unlike <code>@param</code> it can be a
				hyphenated name or a phrase. Targets are <strong>not validated</strong> against the
				parameters, and backticks are stripped, so <code>`options`</code> and <code>options</code>
				are the same key:
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
				The output is a <code>Record&lt;string, string&gt;</code> of target to description, empty
				for the bare form. Without a separator, the first line is the target and any following lines
				are the description.
			</p>
			<p>
				On a component prop, <code>@mutates</code> declares that the component writes into the
				object or array it's handed, the same contract a function declares for a parameter:
				<code>@mutates items - appends the selected entry</code>. Reassigning a prop isn't a
				mutation in this sense; <code>bindable</code> covers that. The two combine: Svelte warns
				when a component mutates state the parent didn't bind, so an in-place write into a parent's
				<code>$state</code> usually sits on a <code>$bindable</code> prop.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="@internal" />
			<p>
				<code>@internal</code> marks a symbol as not stable public API, per TSDoc. It lands as
				<code>internalMessage</code> on declarations and members of every kind, and on component
				props: an empty string for a bare tag, or the trailing prose
				(<code>@internal used during development</code>), kept separate from
				<code>docComment</code>.
			</p>
			<p>
				It's a <strong>marker, not an exclusion</strong>: the declaration stays fully documented, so
				consumers can badge or filter it. To remove a declaration from output, use
				<code>@nodocs</code>; to omit whole modules, use <code>exclude</code> patterns.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="@nodocs" />
			<p>
				<code>@nodocs</code> on a declaration removes it from the output entirely. It doesn't apply
				to members or component props, which stay in the output with no warning. It also affects:
			</p>
			<ul>
				<li>
					<strong>Duplicate checking</strong> (opt-in, via <code>onDuplicates</code>): a hidden
					helper named <code>parse</code> can coexist with a public <code>parse</code> in another
					module without <code>duplicate_declaration</code>.
				</li>
				<li>
					<strong>Re-exports</strong>: on a re-export statement, it drops the
					<code>alsoExportedFrom</code> link, any synthesized alias, and the module's
					<code>reExports</code>, <code>starExports</code>, or <code>externalReExports</code> /
					<code>externalStarExports</code> entry. The canonical declaration is unaffected. In JS, a
					<code>@nodocs</code> in a <code>@typedef</code> block above the statement hides the
					typedef instead, and the re-export stays.
				</li>
				<li>
					<strong>Merged value+type pairs</strong>: a <code>const Foo</code> + <code>type Foo</code>
					pair is one symbol, so the tag on either excludes it.
				</li>
			</ul>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="@cssprop" />
			<p>
				<code>@cssprop</code> documents a CSS custom property a Svelte component reads, the styling
				API a consumer sets as <code>&lt;Card --card_width="20rem" /&gt;</code> or on an ancestor.
				It follows the
				<a href="https://custom-elements-manifest.open-wc.org/">Custom Elements Manifest</a> form,
				with <code>@cssproperty</code> as a synonym:
			</p>
			<Code
				lang="svelte"
				content={`<!--
@component
A card.

@cssprop --card_width - the card's width
@cssprop {<color>} --card_bg - the background color
@cssprop [--card_padding=var(--space_lg)] - the inner padding
-->`}
			/>
			<p>
				An optional braced syntax before the name lands as <code>syntax</code>, verbatim and
				unvalidated, and an optional bracketed default (<code>[--a=1px]</code>) as
				<code>fallback</code>, over any the style gives. The description follows, its leading
				<code>-</code> dropped. A tag that names no <code>--</code> property is dropped, and a
				second tag naming the same property is ignored. The tags never reach
				<code>docComment</code>.
			</p>
			<p>
				Each tag is an entry in <code>cssCustomProperties</code> with <code>documented: true</code>
				and its <code>description</code>, listed first in tag order, ahead of the properties the
				fallback-read heuristic finds alone. That catches the API the heuristic can't: a bare read
				(<code>width: var(--card_width)</code>), one nested in another read's fallback, or one in
				the markup's static style text. A tagged name the style also reads merges into one entry,
				taking the read's <code>sourceLine</code> and, without a tag default, its
				<code>fallback</code>. A tagged name the component never reads stays, at the tag's line, and
				warns <code>unknown_cssprop</code>: usually a typo, sometimes a property left to its
				children.
			</p>
			<p>
				The tags come from the component's doc comment, whichever source wins
				<code>docComment</code>: the in-script JSDoc at or above <code>$props()</code>, else the
				HTML <code>@component</code> comment. The losing source's tags are ignored, as its other
				tags are, and <code>duplicate_comment</code> flags the pair when the JSDoc carries prose, so
				put the <code>@cssprop</code> tags in the comment that carries the component's prose. A
				JSDoc block above <code>$props()</code> holding only tags still wins over the HTML comment,
				with no warning, so its tags are the ones read. Since the heuristic also lists global design
				tokens read with a fallback, a consumer can show only the <code>documented</code> entries of
				a component that has any (see
				<TomeLink slug="output-format" hash="ComponentCssPropertyJson">
					ComponentCssPropertyJson
				</TomeLink>).
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="@module" />
			<p>
				A comment tagged <code>@module</code> documents the file, not the next declaration. Its
				prose lands on <code>ModuleJson.moduleComment</code> and never in a declaration's
				<code>docComment</code>. Its tags parse as a declaration's do, into the module's fields of
				the same names: <code>examples</code>, <code>deprecatedMessage</code>, <code>seeAlso</code>,
				<code>since</code>, and <code>internalMessage</code>. Tags that only describe a declaration
				(<code>@param</code>, <code>@returns</code>, <code>@mutates</code>, <code>@throws</code>,
				<code>@default</code>, <code>@nodocs</code>, <code>@cssprop</code>) warn
				<code>misplaced_tag</code> and are dropped, and unknown tags drop silently. A comment of
				tags alone has no <code>moduleComment</code>. In a module comment only an <code>@</code>
				that starts a line starts a tag, so a mid-line <code>@</code> stays in the text. The comment
				counts as a module comment only when a line starts with <code>@module</code> (a one-line
				<code>/** @module */</code> counts); in <code>/** Text @module */</code> the text documents
				the next declaration instead.
			</p>
			<Code
				lang="ts"
				content={`/**
 * Date math utilities.
 *
 * @see https://tc39.es/proposal-temporal/
 * @since 0.2.0
 * @module
 */

export function add_days(d: Date, n: number): Date { /* ... */ }`}
			/>
			<p>
				Svelte files have three module-comment sources, in priority order: a JSDoc
				<code>@module</code> in the instance <code>&lt;script&gt;</code>, one in
				<code>&lt;script module&gt;</code>, and the first HTML <code>&lt;!-- --&gt;</code> comment
				with <code>@module</code> at a line start. The highest-priority source wins, and more than
				one emits <code>duplicate_comment</code> (<code>commentType: "module_comment"</code>). A
				source whose comment holds only dropped tags yields to a lower one that documents the
				module. An HTML comment's lines parse like a script comment's, with their common indentation
				removed, so its tags and examples work the same way. A comment that's only
				<code>@module</code> isn't a source. Likewise, an HTML <code>@component</code> comment plus
				in-script component JSDoc emits it with <code>commentType: "doc_comment"</code>, and the
				JSDoc wins. The HTML <code>@component</code> comment follows the <code>@module</code> rule:
				the first comment with <code>@component</code> at a line start, parsed the same way, so a
				passing mention doesn't count. svelte2tsx, which editor hover uses, takes the last comment
				containing <code>@component</code> anywhere instead, and
				<code>component_comment_mismatch</code> warns when the two disagree.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Tag-related diagnostics" />
			<p>
				Tag problems surface as warnings: <code>misplaced_tag</code>, <code>unknown_param</code>,
				<code>unknown_cssprop</code>, and <code>duplicate_comment</code>, described in the sections
				above and in <TomeLink slug="diagnostics" />. The parser is
				<ModuleLink module_path="tsdoc.ts">tsdoc.ts</ModuleLink>.
			</p>
		</TomeSection>
	</section>
</TomeContent>
