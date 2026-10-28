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
			A component's styling API is the CSS custom properties its styles read for a consumer to set,
			on the component (<code>&lt;Card --card_width="20rem" /&gt;</code>) or an ancestor. Svelte
			applies a <code>--x</code> attribute on a component by wrapping it in an element with
			<code>display: contents</code> and <code>--x</code> set, so the property reaches the
			component's own elements by inheritance, as one set on any ancestor does. Each component
			declaration lists them in <code>cssCustomProperties</code>, as
			<DeclarationLink name="ComponentCssPropertyJson" /> entries (fields in the
			<TomeLink slug="output-format" hash="ComponentCssPropertyJson">output format</TomeLink>). They
			come from three places: reads with a fallback, found automatically, <code>@property</code>
			rules, and <code>@cssprop</code> tags.
		</p>
	</section>

	<TomeSection>
		<TomeSectionHeader text="Fallback reads" />
		<p>
			Svelte's own docs give <code>var(--track-color, #aaa)</code> as the way to expose a styling
			hook, so a <code>var()</code> with a fallback reads as one: <code>var(--card_bg, white)</code>
			lists <code>--card_bg</code> with <code>fallback: "white"</code>. Reads count anywhere in the
			component's top-level <code>&lt;style&gt;</code>, nested rules, at-rules,
			<code>:global</code>, and keyframes included, and in the static text of the markup's
			<code>style</code> attributes and <code>style:</code> directives, on elements and on child
			components (<code>&lt;Child --a="var(--b, 1px)" /&gt;</code> reads <code>--b</code>). Only the
			outermost <code>var()</code> counts: <code>var(--a, var(--b))</code> lists <code>--a</code>.
			Entries come in the order of each name's first read, the markup's and the style's together.
		</p>
		<p>
			A bare read (<code>var(--color_a_5)</code>) isn't listed, since bare reads are mostly global
			design tokens, and neither is a property the component sets itself: a <code>--a: …</code>
			declaration in its style, a <code>style:--a</code> directive, or <code>--a:</code> in an
			element's <code>style</code> attribute. A <code>--a</code> or <code>style</code> attribute on
			a child component styles the child, so it sets nothing. Names are case-sensitive, as in CSS.
		</p>
		<p>
			<code>fallback</code> is the verbatim source text after the comma, so a multi-line value keeps
			its line breaks; it's empty for <code>var(--a,)</code>. <code>sourceLine</code> is the first
			read's line.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="@property" />
		<p>
			An <code>@property</code> rule in the component's style registers a custom property with CSS
			itself, and lists it even when every read is bare: its <code>syntax</code> descriptor lands as
			<code>syntax</code> (quotes stripped) and its <code>initial-value</code> as
			<code>fallback</code>. A registered property is never unset, so the initial value is what the
			property takes, whatever a <code>var()</code> read falls back to. <code>inherits</code> isn't
			modeled; <code>inherits: false</code> keeps an ancestor's value from reaching the component,
			which makes the property no hook at all. Svelte emits the rule unscoped, as written.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="@cssprop" />
		<p>
			<code>@cssprop</code> in the component's doc comment documents a property, in the
			<a href="https://custom-elements-manifest.open-wc.org/">Custom Elements Manifest</a> form
			(<code>@cssproperty</code> also works):
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
			A tagged property has <code>documented: true</code>, its <code>description</code>, a braced
			<code>syntax</code>, and a bracketed default as <code>default</code>. Documented entries come
			first, in tag order, then the fallback reads. A tag covers what the fallback rule misses, like
			a bare read (<code>width: var(--card_width)</code>); a tagged property the component also
			reads merges with the read, taking its <code>sourceLine</code> and <code>fallback</code> (and
			an <code>@property</code> rule's <code>syntax</code> when the tag gives none), and one it
			never reads warns <code>unknown_cssprop</code> and keeps the tag's line.
		</p>
		<p>
			<code>default</code> is the author's claim and <code>fallback</code> the style's fact, kept
			side by side so neither hides the other: a renderer wanting one value takes
			<code>default ?? fallback</code>. When the two disagree (as text, whitespace runs aside),
			<code>cssprop_default_mismatch</code> warns, usually a stale tag after the style changed; it
			can't tell <code>red</code> from <code>#f00</code>, so write the default as the style does, or
			leave it to the style.
		</p>
		<p>
			A tag that names no <code>--</code> property warns <code>malformed_tag</code> and is dropped;
			a second tag for the same name warns <code>duplicate_tag</code> and the first wins.
		</p>
		<p>
			The tags come from the comment that documents the component: the JSDoc above
			<code>$props()</code> if it has prose or a doc tag (a bare <code>@type</code> doesn't count),
			else the HTML <code>@component</code> comment. The winner takes the slot whole, so when both
			carry documentation, even a JSDoc of tags alone, <code>duplicate_comment</code> warns and the
			HTML comment's prose and tags are lost. Put the tags in the comment that carries the
			component's prose. Legacy <code>export let</code> components read the same, from the HTML
			comment.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Global tokens" />
		<p>
			A global design token read with a fallback, like <code>var(--border_width, 1px)</code>, lists
			as a hook too. In your components, drop the fallback when the token always exists, or tag the
			property when consumers really should set it.
		</p>
		<p>
			There's deliberately no option to filter properties during analysis: the output keeps every
			read, and a consumer that wants fewer filters them, for example to the documented entries when
			a component has any:
		</p>
		<Code
			lang="ts"
			content={`const documented = declaration.cssCustomProperties.filter((p) => p.documented);
const shown = documented.length > 0 ? documented : declaration.cssCustomProperties;`}
		/>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="What isn't read" />
		<ul>
			<li>
				a <code>&lt;style lang="scss"&gt;</code>, or any language but CSS (warns
				<code>css_lang_unsupported</code>)
			</li>
			<li>
				a component Svelte's parser rejects: malformed CSS, or markup its loose parsing can't absorb
				(warns <code>css_parse_failed</code>)
			</li>
			<li>
				properties set from script (<code>style.setProperty</code>) or in a dynamic
				<code>style</code> expression, which count as unset
			</li>
			<li>
				reads inside a dynamic <code>style</code> expression or a <code>&lt;svelte:head&gt;</code>
				style
			</li>
			<li>
				reads in another component: a wrapper documenting a property its child reads through
				inheritance warns <code>unknown_cssprop</code>
			</li>
		</ul>
		<p>
			In the first two cases the component still lists its <code>@cssprop</code> tags, unchecked.
		</p>
	</TomeSection>
</TomeContent>
