<script lang="ts">
	import Code from '@fuzdev/fuz_code/Code.svelte';
	import TomeContent from '@fuzdev/fuz_ui/TomeContent.svelte';
	import TomeSection from '@fuzdev/fuz_ui/TomeSection.svelte';
	import TomeSectionHeader from '@fuzdev/fuz_ui/TomeSectionHeader.svelte';
	import DeclarationLink from '@fuzdev/fuz_ui/DeclarationLink.svelte';
	import TomeLink from '@fuzdev/fuz_ui/TomeLink.svelte';
	import { tome_get_by_slug } from '@fuzdev/fuz_ui/tome.ts';

	const LIBRARY_ITEM_NAME = 'component-styling';

	const tome = tome_get_by_slug(LIBRARY_ITEM_NAME);
</script>

<svelte:head>
	<title>component styling - svelte-docinfo</title>
</svelte:head>

<TomeContent {tome}>
	<section>
		<p>
			A component's styling hooks are the CSS custom properties a consumer can set to style it. Each
			component lists them in <code>cssCustomProperties</code>, as
			<DeclarationLink name="ComponentCssPropertyJson" /> entries. Two kinds are found in its styles
			automatically: a <code>var()</code> read with a fallback, and a property registered with an
			<code>@property</code> rule. You can also document any property with a <code>@cssprop</code>
			tag in the doc comment.
		</p>
	</section>

	<TomeSection>
		<TomeSectionHeader text="Example" />
		<Code
			lang="svelte"
			content={`<!--
@component
A card.

@cssprop {<length>} [--card_width=20rem] - the card's width
@cssprop --card_padding - the inner padding
-->
<div class="card"></div>

<style>
	@property --card_padding {
		syntax: '<length>';
		inherits: true;
		initial-value: 1rem;
	}
	.card {
		width: var(--card_width, 20rem);
		padding: var(--card_padding);
		background: var(--card_bg, white);
		border-radius: var(--border_radius, 4px);
		color: var(--text_color);
	}
</style>`}
		/>
		<p>The component's <code>cssCustomProperties</code>:</p>
		<Code
			lang="json"
			content={`[
  {
    "name": "--card_width",
    "description": "the card's width",
    "syntax": "<length>",
    "fallback": "20rem",
    "default": "20rem",
    "sourceLine": 17,
    "documented": true
  },
  {
    "name": "--card_padding",
    "description": "the inner padding",
    "syntax": "<length>",
    "fallback": "1rem",
    "sourceLine": 18,
    "documented": true
  },
  {"name": "--card_bg", "fallback": "white", "sourceLine": 19},
  {"name": "--border_radius", "fallback": "4px", "sourceLine": 20}
]`}
		/>
		<ul>
			<li>
				<code>--card_width</code> is read with a fallback and tagged: the tag gives
				<code>description</code>, <code>syntax</code>, and <code>default</code>; the read gives
				<code>fallback</code> and <code>sourceLine</code>.
			</li>
			<li>
				<code>--card_padding</code> is read bare, which alone wouldn't list it, but its
				<code>@property</code> rule registers it: the rule supplies <code>syntax</code>, and its
				<code>initial-value</code> becomes <code>fallback</code>.
			</li>
			<li>
				<code>--card_bg</code> is a plain fallback read, listed without a tag.
			</li>
			<li>
				<code>--border_radius</code> is a global design token, but it's read with a fallback, so
				it's listed too; see <a href="#Choosing-what-to-show">choosing what to show</a>.
			</li>
			<li>
				<code>--text_color</code> is read bare and registered nowhere, so it isn't listed: bare
				reads are mostly global tokens the component consumes, not hooks it offers.
			</li>
		</ul>
		<p>
			Documented entries come first, in tag order, then the rest in the order of each name's first
			read. The
			<TomeLink slug="output-format" hash="ComponentCssPropertyJson">output format</TomeLink>
			describes each field.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Fallback reads" />
		<p>
			Svelte's docs use <Code lang="css" inline content="var(--track-color, #aaa)" /> to expose a
			styling hook, so any <code>var()</code> with a fallback counts as one. Reads are found in:
		</p>
		<ul>
			<li>
				the component's top-level <Code lang="svelte" inline content={'<' + 'style>'} />, at any
				depth: nested rules, <code>@media</code>/<code>@container</code>/<code>@supports</code>
				blocks, keyframes, <code>:global</code>
			</li>
			<li>
				the static text of the markup's <code>style</code> attributes and <code>style:</code>
				directives on elements
			</li>
			<li>
				the static text of a child component's <code>style</code> and <code>--a</code> attributes
				(<Code lang="svelte" inline content={'<Child --a="var(--b, 1px)" />'} /> reads
				<code>--b</code>)
			</li>
		</ul>
		<p>
			Only the outermost <code>var()</code> counts:
			<Code lang="css" inline content="var(--a, var(--b))" /> lists <code>--a</code>, with
			<code>--b</code> part of its fallback. A name the component sets itself isn't listed, since
			its own value shadows a consumer's: a <Code lang="css" inline content="--a: …" /> declaration
			in its style, a <code>style:--a</code> directive, or <Code lang="css" inline content="--a:" />
			in an element's <code>style</code> attribute. A <code>--a</code> or <code>style</code>
			attribute on a child component styles the child, not this one. Names are case-sensitive, as in
			CSS.
		</p>
		<p>
			<code>fallback</code> is the verbatim source text after the comma, trimmed, comments and line
			breaks included; it's empty for <Code lang="css" inline content="var(--a,)" />. When a name is
			read several times, <code>sourceLine</code> comes from the first read and
			<code>fallback</code> from the first read that has one, so a bare read before a fallback read
			doesn't keep the name off the list.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="@property" />
		<p>
			An <code>@property</code> rule in the component's style registers a custom property with the
			browser, so the property is listed even when every read is bare. The rule's
			<code>syntax</code> descriptor becomes <code>syntax</code>, quotes stripped, and its
			<code>initial-value</code> becomes <code>fallback</code>: a registered property is never
			unset, so the initial value wins over any <code>var()</code> fallback. When several rules name
			one property, the last wins, as in CSS. A registered name nothing reads isn't listed.
		</p>
		<p>
			<code>inherits</code> isn't modeled. With
			<Code lang="css" inline content="inherits: false" />, a consumer's value never reaches the
			component's elements, so the property isn't a hook at all; register hooks with
			<Code lang="css" inline content="inherits: true" />. Svelte doesn't scope
			<code>@property</code> rules, so a registration applies to the whole page.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="@cssprop" />
		<p>
			<code>@cssprop</code> in the component's doc comment documents a property, in the
			<a href="https://custom-elements-manifest.open-wc.org/">Custom Elements Manifest</a> form
			(<code>@cssproperty</code> is a synonym):
		</p>
		<Code lang={null} content={`@cssprop {<syntax>} [--name=default] - description`} />
		<table>
			<thead>
				<tr>
					<th class="white-space:nowrap">Part</th>
					<th>Field</th>
				</tr>
			</thead>
			<tbody>
				<tr>
					<td><code>{'{<syntax>}'}</code></td>
					<td>
						<code>syntax</code>, verbatim and unvalidated (<code>&lt;color&gt;</code>,
						<code>&lt;length&gt; | auto</code>). Optional; without it, an <code>@property</code>
						rule's syntax fills in.
					</td>
				</tr>
				<tr>
					<td><code>--name</code></td>
					<td>
						<code>name</code>, <code>--</code> included. The brackets are optional without a
						default.
					</td>
				</tr>
				<tr>
					<td><code>=default</code></td>
					<td>
						<code>default</code>, verbatim and trimmed; nested brackets and quoted strings are fine
						(<code>[--a=var(--b, 1px)]</code>). Optional.
					</td>
				</tr>
				<tr>
					<td><code>- description</code></td>
					<td>
						<code>description</code>, raw like <code>docComment</code>, continuation lines included.
						The dash is optional. Inline <code>{'{@link}'}</code> is kept for the renderer.
					</td>
				</tr>
			</tbody>
		</table>
		<p>
			A tagged property is always listed, with <Code lang="ts" inline content="documented: true" />.
			Use a tag to describe a hook, or to list one the fallback rule misses, like a bare read
			(<Code lang="css" inline content="width: var(--card_width)" />). A tagged name the component
			reads anywhere (bare, nested in another fallback, in the markup's static style text, even one
			it sets itself) merges with the read, taking its <code>sourceLine</code> and
			<code>fallback</code>. A tagged name it never reads takes the tag's line and warns
			<code>unknown_cssprop</code>.
		</p>
		<p>
			<code>default</code> is the author's claim and <code>fallback</code> the style's fact, kept
			side by side so neither hides the other; a renderer wanting one value takes
			<code>default ?? fallback</code>. When both exist and differ (compared as text, whitespace
			runs collapsed), <code>cssprop_default_mismatch</code> warns; usually the style changed and
			the tag didn't. Nothing evaluates CSS, so <code>red</code> against <code>#f00</code> warns
			too: write the default as the style does, or omit it and let <code>fallback</code> speak.
		</p>
		<p>
			Tags come from the one comment that documents the component: the JSDoc above
			<code>$props()</code> when it has prose or a tag (a bare <code>@type</code> doesn't count),
			else the HTML <code>@component</code> comment. When both have content, even a JSDoc of tags
			alone, <code>duplicate_comment</code> warns and the HTML comment is ignored, prose and tags
			alike, so keep the tags beside the component's prose. Legacy
			<Code lang="ts" inline content="export let" /> components read only the HTML comment. A tag on
			a prop, a member, or anything but a component documents no property (see
			<TomeLink slug="tags" hash="cssprop" />).
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Warnings" />
		<p>
			Each warning carries the component's name and a line. None removes a listed property; only a
			malformed or repeated tag is itself dropped. The full list is in
			<TomeLink slug="diagnostics" />.
		</p>
		<table>
			<thead>
				<tr>
					<th class="white-space:nowrap">kind</th>
					<th>When</th>
				</tr>
			</thead>
			<tbody>
				<tr>
					<td><code>unknown_cssprop</code></td>
					<td>
						a tag names a property the component never reads: a typo, a stale tag, or one it leaves
						to a child (reads aren't resolved across components)
					</td>
				</tr>
				<tr>
					<td><code>cssprop_default_mismatch</code></td>
					<td>a tag's <code>default</code> differs from the style's <code>fallback</code></td>
				</tr>
				<tr>
					<td><code>malformed_tag</code></td>
					<td>
						a tag names no <code>--</code> property (<code>@cssprop card_width</code>, an unclosed
						brace or bracket, an empty tag); it's dropped
					</td>
				</tr>
				<tr>
					<td><code>duplicate_tag</code></td>
					<td>a tag repeats a name an earlier tag documents; the first wins</td>
				</tr>
				<tr>
					<td><code>css_lang_unsupported</code>, <code>css_parse_failed</code></td>
					<td>
						the style wasn't read (below); the tags are listed unchecked, with no
						<code>fallback</code>
					</td>
				</tr>
			</tbody>
		</table>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Choosing what to show" />
		<p>
			A global design token read with a fallback, like
			<Code lang="css" inline content="var(--border_radius, 4px)" /> in the example, lists as a hook
			too, because the analyzer can't tell a token from a hook. In your own components, drop the
			fallback when the token always exists, or tag the real hooks so consumers can show only those.
		</p>
		<p>
			There's deliberately no option to filter during analysis: the output keeps every read, and a
			consumer that wants fewer filters them. A common rule: show the documented entries when a
			component has any, else all of them:
		</p>
		<Code
			lang="ts"
			content={`const documented = declaration.cssCustomProperties.filter((p) => p.documented);
const shown = documented.length > 0 ? documented : declaration.cssCustomProperties;`}
		/>
		<p>
			An entry maps onto a Custom Elements Manifest <code>cssProperties</code> entry field for field
			(<code>name</code>, <code>description</code>, <code>syntax</code>, <code>default</code>);
			<code>fallback</code>, <code>sourceLine</code>, and <code>documented</code> have no manifest
			counterpart.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="What isn't read" />
		<ul>
			<li>
				a <Code lang="svelte" inline content={'<' + 'style lang="scss">'} />, or any language but
				CSS (warns <code>css_lang_unsupported</code>)
			</li>
			<li>
				a component Svelte's parser rejects: malformed CSS, or markup its loose parsing can't absorb
				(warns <code>css_parse_failed</code>)
			</li>
			<li>
				reads inside a dynamic <code>style</code> expression (<code>style="color: {'{c}'}"</code>),
				or in a <Code lang="svelte" inline content={'<svelte:head>'} /> style
			</li>
			<li>
				properties set from script (<code>style.setProperty</code>) or in a dynamic
				<code>style</code> expression: they count as unset, so their fallback reads stay listed
			</li>
			<li>
				reads in another component: a wrapper documenting a property its child reads through
				inheritance warns <code>unknown_cssprop</code>
			</li>
		</ul>
	</TomeSection>
</TomeContent>
