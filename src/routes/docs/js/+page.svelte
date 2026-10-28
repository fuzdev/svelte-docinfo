<script lang="ts">
	import Code from '@fuzdev/fuz_code/Code.svelte';
	import TomeContent from '@fuzdev/fuz_ui/TomeContent.svelte';
	import TomeSection from '@fuzdev/fuz_ui/TomeSection.svelte';
	import TomeSectionHeader from '@fuzdev/fuz_ui/TomeSectionHeader.svelte';
	import TomeLink from '@fuzdev/fuz_ui/TomeLink.svelte';
	import { tome_get_by_slug } from '@fuzdev/fuz_ui/tome.ts';

	const LIBRARY_ITEM_NAME = 'js';

	const tome = tome_get_by_slug(LIBRARY_ITEM_NAME);
</script>

<svelte:head>
	<title>JS and JSDoc - svelte-docinfo</title>
</svelte:head>

<TomeContent {tome}>
	<section>
		<p>
			JS modules (<code>.js</code>, <code>.mjs</code>, <code>.jsx</code>), JS components, and JS
			<Code lang="svelte" inline content={'<' + 'script module>'} /> blocks document like their TS
			twins: svelte-docinfo reads their JSDoc the way TypeScript's checker does, so
			<Code lang="ts" inline content={'/** @param {string} a */'} /> types a parameter as
			<Code lang="ts" inline content="a: string" /> would. <code>allowJs</code> is always on for the
			analysis, so no tsconfig change is needed, and <code>checkJs</code> isn't required.
		</p>
		<p>
			TypeScript reads none of this in <code>.ts</code> files: there, JSDoc types and the tags below
			annotate nothing, as in your editor.
		</p>
	</section>

	<TomeSection>
		<TomeSectionHeader text="Types and parameters" />
		<p>
			A <code>@type</code>, <code>@param</code>, <code>@returns</code>, or <code>@property</code>
			type is the written annotation at its site, so it recovers alias names and keeps union order
			as written, like a TS annotation (see <TomeLink slug="structured-types" />).
		</p>
		<Code
			lang="js"
			content={`/**
 * @param {string} a - a required parameter
 * @param {number} [b] - optional, as is \`{number=}\`
 * @param {number} [c=0] - optional, with defaultValue "0"
 * @param {object} [d] - an options object
 * @param {boolean} [d.e] - documents d's property e
 */
export function fn(a, b, c = 0, d) {}`}
		/>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="@typedef and @callback" />
		<p>
			A <code>@typedef</code> or <code>@callback</code> documents as a type alias, like
			<Code lang="ts" inline content="type A = …" />: <code>@property</code> tags become members
			with their descriptions, a callback gets a <code>(call)</code> member, and
			<code>@template</code> tags its generics. A <Code lang="ts" inline content="const A" /> with a
			same-named <code>@typedef A</code> documents as one declaration with
			<Code lang="ts" inline content="mergedValue: true" />.
		</p>
		<p>
			As in your editor's hover, a JSDoc block that declares a typedef and has no
			<code>@param</code> or <code>@returns</code> documents the typedef, not the declaration below
			it. Give the declaration its own block:
		</p>
		<Code
			lang="js"
			content={`/**
 * A point.
 * @typedef {object} Point
 * @property {number} x - the horizontal position
 * @property {number} y - the vertical position
 */

/** The origin. */
export const ORIGIN = {x: 0, y: 0};`}
		/>
		<p>
			A <code>@module</code> block keeps its prose for the module, and a component's JSDoc above
			<code>$props()</code> for the component. A <code>@typedef</code> in a component's HTML
			<code>@component</code> comment documents nothing. Declare a component's props typedef in a
			block of its own, since svelte2tsx copies the block above <code>$props()</code> into its
			generated code, where svelte-check reports a typedef as a duplicate.
		</p>
		<p>
			An <code>@enum</code> const documents as <Code lang="ts" inline content="kind: 'enum'" />, one
			member per property.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="@template" />
		<p>
			<code>@template</code> tags are <code>genericParams</code> on functions, classes, and methods,
			with constraints (<code>@template {'{string}'} K</code>) and defaults
			(<code>@template [K='k']</code>), as
			<Code lang="ts" inline content={`<K extends string = 'k'>`} /> writes them.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="@overload" />
		<p>
			Each <code>@overload</code> tag declares a signature, documented by the block it sits in and
			the <code>@param</code> and <code>@returns</code> tags after it. The first overload documents
			the function, and the implementation's own block is hidden, as in a TS overload set, so put
			the prose and tags like <code>@example</code> on the first overload; a documented
			implementation warns <code>implementation_doc_hidden</code>. Write <code>@template</code>
			before <code>@overload</code>, since TypeScript rejects one between <code>@overload</code> and
			its <code>@param</code>s.
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
		<TomeSectionHeader text="Classes" />
		<ul>
			<li>
				<code>@private</code> hides a member, and <code>@protected</code>, <code>@public</code>, and
				<code>@readonly</code> add <code>modifiers</code>, like the TS keywords.
			</li>
			<li>
				<code>@implements {'{A}'}</code> fills <code>implements</code>, and
				<code>@extends {'{Base<T>}'}</code> beside <Code lang="ts" inline content="extends Base" />
				gives the type arguments.
			</li>
			<li>
				<Code lang="ts" inline content="this.x = …" /> in the constructor, a method, or an accessor
				declares a member (static in a static method or block), typed by its first
				<code>@type</code> and documented by its first documented assignment, preferring the
				constructor's. These members list just before the constructor, where a TS class declares its
				fields.
			</li>
			<li>
				A name the base class declares stays the base's
				(<Code lang="ts" inline content="this.name = …" /> in an <code>Error</code> subclass lists
				nothing). To document it on the subclass, write a field.
			</li>
		</ul>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Components" />
		<p>
			A JS component's props come from the JSDoc <code>@type</code> on <code>$props()</code>, often
			a typedef, else from the destructuring. A legacy component's
			<Code lang="ts" inline content="export let" /> props read their <code>@type</code> and
			initializer.
		</p>
		<Code
			lang="svelte"
			content={'<' +
				`script>
	/**
	 * @typedef {object} Props
	 * @property {string} a - documents prop a
	 */

	/**
	 * The component's docs.
	 * @type {Props}
	 */
	const {a} = $props();
</script>`}
		/>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="CommonJS" />
		<p>
			CommonJS isn't modeled. A JS file with no <code>import</code> or <code>export</code> that
			exports through <code>module.exports</code> or <code>exports.x</code> documents nothing and
			warns <code>commonjs_unsupported</code>. Under <code>node16</code>/<code>nodenext</code> or
			<Code lang="ts" inline content="moduleDetection: 'force'" />, TypeScript reads CommonJS
			exports itself, so named ones (<code>exports.x</code>,
			<Code lang="ts" inline content={'module.exports = {a, b}'} />) document. Exports defined
			through <code>Object.defineProperty</code> or a UMD wrapper document nothing, with no warning.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Limits" />
		<ul>
			<li>
				Assignments outside a class (<Code lang="ts" inline content="A.prototype.x = …" />,
				<Code lang="ts" inline content="A.x = …" />) don't add class members.
			</li>
			<li>
				An <code>@overload</code>'s rest parameter (<Code lang="ts" inline content={'{...T}'} />) is
				<code>rest</code>, but types as <Code lang="ts" inline content="T | undefined" />, as
				TypeScript reads it.
			</li>
			<li>
				A <code>@property</code> after a non-<code>@property</code> tag leaves the typedef's
				property list, as TypeScript reads it, and is dropped.
			</li>
		</ul>
	</TomeSection>
</TomeContent>
