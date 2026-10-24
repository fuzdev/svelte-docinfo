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
			on the component (<code>&lt;Card --card_width="20rem" /&gt;</code>) or an ancestor. Each
			component declaration lists them in <code>cssCustomProperties</code>, as
			<DeclarationLink name="ComponentCssPropertyJson" /> entries (fields in the
			<TomeLink slug="output-format" hash="ComponentCssPropertyJson">output format</TomeLink>). They
			come from two places: reads with a fallback, found automatically, and <code>@cssprop</code>
			tags.
		</p>
	</section>

	<TomeSection>
		<TomeSectionHeader text="Fallback reads" />
		<p>
			A <code>var()</code> with a fallback in the component's <code>&lt;style&gt;</code> reads as a
			hook for consumers, so <code>var(--card_bg, white)</code> lists <code>--card_bg</code> with
			<code>fallback: "white"</code>. Reads count anywhere in the stylesheet, nested rules,
			at-rules, <code>:global</code>, and keyframes included, but only the outermost
			<code>var()</code>: <code>var(--a, var(--b))</code> lists <code>--a</code>.
		</p>
		<p>
			A bare read (<code>var(--color_a_5)</code>) isn't listed, since bare reads are mostly global
			design tokens, and neither is a property the component sets itself: a <code>--a: …</code>
			declaration in its style, a <code>style:--a</code> directive, or <code>--a:</code> in an
			element's <code>style</code> attribute.
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
			<code>syntax</code>, and a bracketed default as its <code>fallback</code>. Documented entries
			come first, in tag order, then the fallback reads. A tag covers what the fallback rule misses,
			like a bare read (<code>width: var(--card_width)</code>); a tagged property the component also
			reads merges with the read, and one it never reads warns <code>unknown_cssprop</code>.
		</p>
		<p>
			The tags come from the comment that documents the component: the JSDoc above
			<code>$props()</code> if it has prose or a doc tag (a bare <code>@type</code> doesn't count),
			else the HTML <code>@component</code> comment. A JSDoc block of tags alone still wins, with no
			warning, so put the tags in the comment that carries the component's prose.
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
			<li>a style Svelte's parser rejects (warns <code>css_parse_failed</code>)</li>
			<li>
				properties set from script (<code>style.setProperty</code>) or in a dynamic
				<code>style</code> expression, which count as unset
			</li>
			<li>
				reads inside a dynamic <code>style</code> expression or a <code>&lt;svelte:head&gt;</code>
				style
			</li>
		</ul>
		<p>
			In the first two cases the component still lists its <code>@cssprop</code> tags, unchecked.
		</p>
	</TomeSection>
</TomeContent>
