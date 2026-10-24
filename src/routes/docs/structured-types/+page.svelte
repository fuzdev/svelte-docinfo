<script lang="ts">
	import Code from '@fuzdev/fuz_code/Code.svelte';
	import TomeContent from '@fuzdev/fuz_ui/TomeContent.svelte';
	import TomeSection from '@fuzdev/fuz_ui/TomeSection.svelte';
	import TomeSectionHeader from '@fuzdev/fuz_ui/TomeSectionHeader.svelte';
	import DeclarationLink from '@fuzdev/fuz_ui/DeclarationLink.svelte';
	import TomeLink from '@fuzdev/fuz_ui/TomeLink.svelte';
	import { tome_get_by_slug } from '@fuzdev/fuz_ui/tome.ts';

	const LIBRARY_ITEM_NAME = 'structured-types';

	const tome = tome_get_by_slug(LIBRARY_ITEM_NAME);
</script>

<svelte:head>
	<title>structured types - svelte-docinfo</title>
</svelte:head>

<TomeContent {tome}>
	<section>
		<p>
			Types come two ways. The flat strings (<code>typeSignature</code>, <code>type</code>,
			<code>returnType</code>) are the TypeScript checker's own rendering. Beside them, a
			<DeclarationLink name="TypeJson" /> tree in <code>typeInfo</code> (<code>returnTypeInfo</code>
			for return types) gives the structure, for rendering types with links and highlighting.
		</p>
		<p>
			<code>typeInfo</code> appears on variables, type aliases, variable members, component props,
			parameters, and tuple elements; <code>returnTypeInfo</code> on functions, function members,
			overloads, and callback props.
		</p>
	</section>

	<TomeSection>
		<TomeSectionHeader text="When it's present" />
		<p>
			A tree is absent when the flat string says everything: intrinsics, bare references, and object
			and function types. It's present when it adds structure: union and intersection members, a
			reference's type arguments, array elements, and tuple elements with their labels and
			<code>?</code>/<code>...</code> markers.
		</p>
		<p>
			A type alias's <code>typeSignature</code> prints only its name, so an alias carries its tree
			whatever the shape, except object and function types, which its <code>members</code> cover.
			Intrinsic and literal aliases (<code>type A = string</code>) print structurally and get no
			tree.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Nodes" />
		<p>
			The node kinds are <code>intrinsic</code>, <code>literal</code>, <code>reference</code>,
			<code>array</code>, <code>tuple</code>, <code>union</code>, <code>intersection</code>,
			<code>function</code>, <code>object</code>, and <code>other</code>.
		</p>
		<ul>
			<li>
				Union and intersection members keep alias names. Union members follow the order the author
				wrote them, with <code>null</code> and <code>undefined</code> last, while the flat strings
				use TypeScript's internal order, so read the tree for author intent. A union with no written
				form (inferred, <code>keyof</code>, mapped) keeps TypeScript's order in both.
			</li>
			<li>
				A literal's <code>value</code> is its runtime value, except that a bigint is its text
				(<code>"1n"</code>) and a non-finite number a string (<code>"Infinity"</code>).
			</li>
			<li>
				A named generic instantiation is a <code>reference</code> with <code>typeArgs</code>
				(<code>Snippet&lt;[a: string]&gt;</code>), and other callables are <code>function</code>
				nodes. Object literal and function types are <code>object</code> and <code>function</code>
				nodes carrying the checker's text.
			</li>
			<li>
				Arrays and tuples carry <code>readonly</code>, and the optional-property
				<code>undefined</code> is dropped, since <code>optional: true</code> says it.
			</li>
		</ul>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Lost alias names" />
		<p>
			TypeScript drops the name of an alias over an indexed access or conditional type, like
			<code>type Foo = z.infer&lt;typeof S&gt;</code> or valibot's <code>InferOutput</code>, and
			prints its expanded structure wherever it's used. The tree recovers the name as
			<code>{`{kind: "reference", name: "Foo"}`}</code>, from the annotation written at that
			position or by matching the project's exported aliases. A name recovered by matching also
			carries <code>module</code>, the <code>ModuleJson.path</code> declaring it.
		</p>
		<p>
			An exported alias neither way recovers warns <code>alias_lost</code> (see
			<TomeLink slug="diagnostics" />). Declaring it as an interface keeps its name:
			<code>interface Foo extends z.infer&lt;typeof S&gt; {'{}'}</code>.
		</p>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Rendering" />
		<p>
			<DeclarationLink name="typeJsonToTokens" /> flattens a tree into tokens, deciding spacing,
			separators, and parentheses, so a renderer only decides what each token looks like: link
			<code>name</code> tokens, highlight <code>code</code> tokens, and print <code>text</code>
			as-is. <DeclarationLink name="typeJsonToText" /> joins them into a plain string.
		</p>
		<Code
			lang="ts"
			content={`import {typeJsonToTokens} from 'svelte-docinfo/declaration-helpers.js';

if (declaration.typeInfo) typeJsonToTokens(declaration.typeInfo);
// [{kind: 'name', name: 'Map'}, {kind: 'text', text: '<'},
//  {kind: 'code', text: 'string'}, {kind: 'text', text: ', '},
//  {kind: 'name', name: 'Tome'}, {kind: 'text', text: '>'}]`}
		/>
	</TomeSection>

	<TomeSection>
		<TomeSectionHeader text="Module paths" />
		<p>
			TypeScript prints a module object as <code>typeof import("…")</code> with an absolute path.
			svelte-docinfo rewrites the path in every type text, flat and structured: a module in the
			output becomes its <code>ModuleJson.path</code>, usable as a lookup key, a package its path
			below <code>node_modules/</code>, and any other file a path relative to the project root. In a
			tree, a module object is an <code>other</code> node.
		</p>
	</TomeSection>
</TomeContent>
