<script lang="ts">
	import Code from '@fuzdev/fuz_code/Code.svelte';
	import TomeContent from '@fuzdev/fuz_ui/TomeContent.svelte';
	import TomeSection from '@fuzdev/fuz_ui/TomeSection.svelte';
	import TomeSectionHeader from '@fuzdev/fuz_ui/TomeSectionHeader.svelte';
	import ModuleLink from '@fuzdev/fuz_ui/ModuleLink.svelte';
	import DeclarationLink from '@fuzdev/fuz_ui/DeclarationLink.svelte';
	import TomeLink from '@fuzdev/fuz_ui/TomeLink.svelte';
	import { tome_get_by_slug } from '@fuzdev/fuz_ui/tome.ts';

	const LIBRARY_ITEM_NAME = 'output-format';

	const tome = tome_get_by_slug(LIBRARY_ITEM_NAME);
</script>

<svelte:head>
	<title>output format - svelte-docinfo</title>
</svelte:head>

<TomeContent {tome}>
	<section>
		<p>
			svelte-docinfo outputs JSON describing your project's exported API. Modules contain
			declarations, and some declarations contain members or props. To see it in practice, jump to
			the <a href="#Examples">examples</a>.
		</p>

		<TomeSection>
			<TomeSectionHeader text="Top-level structure" />
			<p>
				Every surface returns the same envelope, <DeclarationLink name="AnalyzeResultJson" />: the
				<TomeLink slug="js-api">JS API</TomeLink> (<code>analyze</code>,
				<code>analyzeFromFiles</code>, a session's <code>query()</code>), the CLI's JSON, and the
				Vite plugin's virtual module.
			</p>
			<Code
				lang="ts"
				content={`{
  modules: ModuleJson[],
  diagnostics: Diagnostic[]
}`}
			/>
			<p>
				<code>diagnostics</code> is covered in <TomeLink slug="diagnostics" />. The CLI emits
				<a href="#Compact-JSON">compact JSON</a>, so an empty project prints <code>{`{}`}</code>;
				parse it with <DeclarationLink name="parseAnalyzeResult" /> to restore the defaults.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="ModuleJson" />
			<p>
				A <DeclarationLink name="ModuleJson" /> describes a single source file and its exports:
			</p>
			<ul>
				<li>
					<code>path</code>: file path relative to the source root (e.g., <code>"math.ts"</code>)
				</li>
				<li><code>declarations</code>: exported items from this module</li>
				<li>
					<code>moduleComment</code>: the prose of the file-level <code>@module</code> comment, if
					it has any
				</li>
				<li>
					<code>examples</code>, <code>deprecatedMessage</code>, <code>seeAlso</code>,
					<code>since</code>, <code>internalMessage</code>: that comment's tags, as on a declaration
					(see <TomeLink slug="tags" hash="module">@module</TomeLink>)
				</li>
				<li><code>dependencies</code>: paths of modules this file imports</li>
				<li><code>dependents</code>: paths of modules that import this file</li>
				<li><code>starExports</code>: <code>export * from './module'</code> targets</li>
				<li>
					<code>reExports</code>: same-name re-export edges
					(<code>{`{name, module, typeOnly, sourceLine}`}</code>), the forward view of
					<code>alsoExportedFrom</code> (see <TomeLink slug="re-exports" />)
				</li>
				<li>
					<code>externalReExports</code>: direct re-exports from packages
					(<code>{`{name, specifier, originalName?, typeOnly, sourceLine}`}</code>)
				</li>
				<li>
					<code>externalStarExports</code>: <code>export * from 'pkg'</code> specifiers as written
				</li>
				<li>
					<code>partial</code>: <code>true</code> when the module is a placeholder for a
					<code>.svelte</code> file that svelte2tsx failed to transform (see
					<code>transform_failed</code>)
				</li>
			</ul>
			<p>
				Array fields are omitted from JSON when empty and default to <code>[]</code> after parsing.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="DeclarationJson" />
			<p>
				Each declaration is a <DeclarationLink name="DeclarationJson" />, a discriminated union on
				<code>kind</code> with nine variants:
			</p>
			<ul>
				<li>
					<code>"function"</code>: adds <code>parameters</code>, <code>returnType</code>,
					<code>returnTypeInfo</code>, <code>returnDescription</code>, <code>overloads</code>
				</li>
				<li>
					<code>"variable"</code>: adds <code>typeInfo</code>, optional <code>defaultValue</code>
					(from <code>@default</code>), and <code>reactivity</code> (see
					<a href="#Reactivity">Reactivity</a>)
				</li>
				<li>
					<code>"class"</code>: adds <code>members</code>, <code>extends</code>,
					<code>implements</code>, <code>externalTypes</code>
				</li>
				<li>
					<code>"interface"</code>: adds <code>members</code>, <code>extends</code>,
					<code>externalTypes</code>, <code>mergedValue</code>
				</li>
				<li>
					<code>"type"</code>: adds <code>typeInfo</code>, <code>members</code>,
					<code>externalTypes</code>, <code>mergedValue</code>
				</li>
				<li><code>"enum"</code>: adds <code>members</code> (enum values)</li>
				<li>
					<code>"component"</code>: adds <code>props</code>, <code>externalTypes</code>,
					<code>acceptsChildren</code>, <code>cssCustomProperties</code>, <code>lang</code> (Svelte
					components). <code>acceptsChildren</code> is set by a <code>Snippet</code>-typed
					<code>children</code> prop, template use of <code>children</code>, or a legacy component's
					default <code>&lt;slot /&gt;</code>
				</li>
				<li>
					<code>"snippet"</code>: adds <code>parameters</code> (exported Svelte template snippets)
				</li>
				<li>
					<code>"namespace"</code>: adds <code>module</code>, the path of the module projected by
					<code>export * as ns from './x'</code>
				</li>
			</ul>
			<p>
				A name declared as both a value and a type, like the schema pattern
				<code>{`export const Foo = z.strictObject({...})`}</code> +
				<code>{`export type Foo = z.infer<typeof Foo>`}</code>, produces one declaration. The type
				meaning documents like its un-merged equivalent (structure, <code>members</code>,
				<code>typeInfo</code>), and <code>mergedValue: true</code> marks that the name is also a
				runtime value, so <DeclarationLink name="generateImport" /> emits <code>import</code>
				instead of <code>import type</code>. JSDoc falls back to the value declaration's comment
				when the type has none, and <code>@nodocs</code> on either declaration excludes the pair. In
				JS, a <code>const Foo</code> with a same-named <code>@typedef</code> merges the same way.
			</p>
			<p>Shared fields on all variants:</p>
			<ul>
				<li>
					<code>name</code>, <code>kind</code>: identity. Default exports carry
					<code>name === "default"</code>, except Svelte components, which take their
					filename-derived name (see <TomeLink slug="re-exports" />)
				</li>
				<li><code>docComment</code>: JSDoc comment text</li>
				<li>
					<code>typeSignature</code>: the full type as a string, rendered by the TypeScript checker
					(see <TomeLink slug="structured-types" hash="Module-paths">module paths</TomeLink>)
				</li>
				<li><code>sourceLine</code>: line number in the source file</li>
				<li>
					<code>modifiers</code>: e.g., <code>"readonly"</code>, <code>"static"</code>,
					<code>"getter"</code>
				</li>
				<li><code>genericParams</code>: type parameters with constraints and defaults</li>
				<li>
					<code>examples</code>, <code>deprecatedMessage</code>, <code>seeAlso</code>,
					<code>throws</code>, <code>since</code>: from standard JSDoc tags
				</li>
				<li>
					<code>internalMessage</code>: from <code>@internal</code>, a marker rather than an
					exclusion (empty string for a bare tag)
				</li>
				<li>
					<code>mutates</code>: from <code>@mutates</code>, a
					<code>Record&lt;string, string&gt;</code> of target to description (empty for a target
					with no description). See <TomeLink slug="tags" />
				</li>
				<li><code>alsoExportedFrom</code>: modules that re-export this declaration</li>
				<li>
					<code>aliasOf</code>: the canonical <code>{`{module, name}`}</code> of a renamed re-export
				</li>
				<li>
					<code>partial</code>: <code>true</code> when extraction failed partway, so the data is
					incomplete
				</li>
			</ul>
			<p>
				Declarations tagged <code>@nodocs</code> are excluded from the output and from the opt-in
				duplicate-name check.
			</p>
			<p>
				Props and members a package contributes (like <code>HTMLButtonAttributes</code> extended by
				a component's props) are left out, and the package type is named in
				<code>externalTypes</code>, unless the <code>$props()</code> destructuring names them.
			</p>
			<p>
				<code>typeInfo</code>, a structured <DeclarationLink name="TypeJson" /> tree beside the flat
				type string, appears on variables, type aliases, variable members, component props,
				parameters, and tuple elements; functions, function members, overloads, and callback props
				carry <code>returnTypeInfo</code>. See <TomeLink slug="structured-types" />.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="MemberJson" />
			<p>
				Classes, interfaces, types, and enums list <DeclarationLink name="MemberJson" /> entries in
				<code>members</code>, a discriminated union on <code>kind</code> with three variants:
			</p>
			<ul>
				<li>
					<code>"function"</code>: methods and call signatures. Adds <code>parameters</code>,
					<code>returnType</code>, <code>returnTypeInfo</code>, <code>returnDescription</code>,
					<code>overloads</code>, and optional <code>defaultValue</code> (from
					<code>@default</code>, documenting the behavior when a callable option is omitted). A
					property typed by an external function (<code>run?: typeof spawn</code>) is a
					<code>"variable"</code> with the flat type text rather than the package's overloads and
					docs; a mixed callable keeps its local signatures
				</li>
				<li>
					<code>"constructor"</code>: class constructors and construct signatures. Adds
					<code>parameters</code>, <code>overloads</code>
				</li>
				<li>
					<code>"variable"</code>: properties, accessors, index signatures, and enum values. Adds
					optional <code>defaultValue</code> (from <code>@default</code>), <code>typeInfo</code>,
					and <code>reactivity</code> for class fields initialized with a Svelte rune
				</li>
			</ul>
			<p>
				Function and variable members also carry <code>optional</code> when the property or method
				is optional (<code>?</code>, or a mapped modifier such as <code>Partial</code>).
			</p>
			<p>Nesting is exactly one level deep: members never contain members.</p>
			<p>
				Member <code>name</code> is the source identifier, or a synthesized name where none exists:
				<code>"constructor"</code> (class constructor), <code>"(construct)"</code> and
				<code>"(call)"</code> (construct and call signatures on an interface or type alias), and
				index-signature names like <code>"[key: string]"</code> (the parameter name as written for
				interfaces; a synthesized <code>key</code> for type aliases).
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="ComponentPropJson" />
			<p>
				Component declarations have a <code>props</code> array of
				<DeclarationLink name="ComponentPropJson" /> entries, in source order, followed by any props
				an external type declares that the <code>$props()</code> destructuring names, in
				destructuring order (a legacy <code>export let</code> component orders by its exports). Each
				entry has:
			</p>
			<ul>
				<li><code>name</code>, <code>type</code>: prop name and TypeScript type</li>
				<li>
					<code>typeInfo</code>: structured <DeclarationLink name="TypeJson" /> tree, when it adds
					structure
				</li>
				<li><code>optional</code>: whether the prop is optional</li>
				<li><code>description</code>: from JSDoc on the prop</li>
				<li>
					<code>defaultValue</code>: the default's source text, else the <code>@default</code> tag
					text
				</li>
				<li>
					<code>bindable</code>: set when the prop is declared with <code>$bindable()</code>, so
					<code>&lt;Foo bind:value /&gt;</code> works. Every prop of a legacy
					<code>export let</code> component is bindable
				</li>
				<li>
					<code>parameters</code>: structured parameters for snippet-typed props (e.g.,
					<code>Snippet&lt;[text: string]&gt;</code>) and callback props; absent when there are none
				</li>
				<li>
					<code>returnType</code> and <code>returnTypeInfo</code>: a callback prop's return type
					(<code>onpick?: (value: string) =&gt; void</code>, or a project alias for one). Its
					presence is what marks a prop as a callback, including one with no parameters; snippets
					never carry it. Only call signatures your project declares count, so a prop typed wholly
					by a package (<code>MouseEventHandler&lt;HTMLButtonElement&gt;</code>, a
					<code>Component</code>) has neither field
				</li>
				<li>
					<code>examples</code>, <code>deprecatedMessage</code>, <code>seeAlso</code>,
					<code>throws</code>, <code>since</code>, <code>internalMessage</code>,
					<code>mutates</code>: from the prop's own doc comment. On a prop, <code>mutates</code>
					declares what the component writes into the object or array it's handed
				</li>
			</ul>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="ComponentCssPropertyJson" />
			<p>
				A component's <code>cssCustomProperties</code> lists its styling API as
				<DeclarationLink name="ComponentCssPropertyJson" /> entries, documented ones first (see
				<TomeLink slug="component-styling" />):
			</p>
			<ul>
				<li><code>name</code>: the property as written, <code>--</code> included</li>
				<li><code>description</code>: from a <code>@cssprop</code> tag</li>
				<li>
					<code>syntax</code>: a tag's braced syntax, else an <code>@property</code> rule's
					<code>syntax</code> descriptor
				</li>
				<li>
					<code>fallback</code>: what the style gives the property when unset, as source text: an
					<code>@property</code> rule's <code>initial-value</code>, else the first read's fallback
					(<code>var(--a, var(--b))</code> gives <code>var(--b)</code>)
				</li>
				<li>
					<code>default</code>: a <code>@cssprop</code> tag's bracketed default, the author's claim
					beside <code>fallback</code>; a renderer wanting one value takes
					<code>default ?? fallback</code>
				</li>
				<li>
					<code>sourceLine</code>: the first read's line, or the tag's for a property never read
				</li>
				<li><code>documented</code>: whether a <code>@cssprop</code> tag documents it</li>
			</ul>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="ParameterJson" />
			<p>
				Functions, methods, constructors, overloads, snippets, and snippet or callback props list
				<DeclarationLink name="ParameterJson" /> entries in <code>parameters</code>:
			</p>
			<ul>
				<li>
					<code>name</code>: parameter name (e.g., <code>"options"</code>; a rest parameter's dots
					live in <code>rest</code>, not the name)
				</li>
				<li><code>type</code>: resolved TypeScript type as a string</li>
				<li>
					<code>typeInfo</code>: structured <DeclarationLink name="TypeJson" /> tree, when it adds
					structure
				</li>
				<li>
					<code>optional</code>: whether a caller may omit the argument (a <code>?</code>, a
					default, or in JS a bracketed <code>@param {'{T}'} [b]</code>)
				</li>
				<li><code>rest</code>: whether the parameter uses rest syntax (<code>...args</code>)</li>
				<li><code>description</code>: from <code>@param</code></li>
				<li>
					<code>defaultValue</code>: default value expression from the source, if present, else from
					a bracketed <code>@param {'{T}'} [b=0]</code>
				</li>
				<li>
					<code>propertyDescriptions</code>: sub-path to description, from dotted
					<code>@param obj.prop</code> tags on a named object parameter (destructured parameters
					aren't covered)
				</li>
			</ul>
			<p>
				<DeclarationLink name="ParameterJson" /> deliberately lacks the tag fields
				<code>ComponentPropJson</code> has: a prop is a named slot with its own documentation, while
				a parameter's <code>@example</code>, <code>@deprecated</code>, and similar tags belong on
				the enclosing function per the TSDoc spec. Parameters get their docs from
				<code>@param</code> only.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="OverloadJson" />
			<p>
				Functions and constructors with multiple signatures list
				<DeclarationLink name="OverloadJson" /> entries in <code>overloads</code>. Each carries only
				the fields that vary per signature:
			</p>
			<ul>
				<li><code>typeSignature</code>: the full overload signature as a string</li>
				<li>
					<code>parameters</code>: this overload's parameters, with its own <code>@param</code>
					descriptions
				</li>
				<li><code>returnType</code>: return type for this overload (functions only)</li>
				<li>
					<code>returnTypeInfo</code>: structured <DeclarationLink name="TypeJson" /> tree for the
					return type, when it adds structure
				</li>
				<li><code>genericParams</code>: type parameters for this overload</li>
				<li><code>docComment</code>: per-overload JSDoc text, if present</li>
				<li><code>returnDescription</code>: from <code>@returns</code> on this overload</li>
			</ul>
			<p>
				Symbol-scope tags (<code>@example</code>, <code>@deprecated</code>, and the rest) live on
				the parent declaration only, read from the primary overload. On a non-primary overload they
				emit <code>misplaced_tag</code> and are dropped. See
				<TomeLink slug="tags" hash="Symbol-scope-vs-signature-scope">
					Symbol-scope vs signature-scope
				</TomeLink>.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Reactivity" />
			<p>
				<code>reactivity</code> appears on <DeclarationLink name="VariableDeclarationJson" /> and
				<DeclarationLink name="VariableMemberJson" /> when the initializer is a value-producing
				Svelte rune call: <code>$state</code>, <code>$state.raw</code>, <code>$derived</code>, or
				<code>$derived.by</code>. Detection is syntactic and runs on every file, so a plain
				<code>.ts</code> file is treated the same as <code>.svelte.ts</code> or a component script.
			</p>
			<p>
				Only variables and class fields are annotated, not parameters or destructured bindings.
				<code>$props</code> and <code>$bindable</code> surface on
				<DeclarationLink name="ComponentPropJson" /> instead.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="GenericParamJson" />
			<p>
				Declarations and members with type parameters list
				<DeclarationLink name="GenericParamJson" /> entries in <code>genericParams</code>:
			</p>
			<ul>
				<li><code>name</code>: type parameter name (e.g., <code>"T"</code>)</li>
				<li><code>constraint</code>: <code>extends</code> constraint, if present</li>
				<li><code>defaultType</code>: default type, if present</li>
			</ul>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Compact JSON" />
			<p>
				Output uses compact JSON via <DeclarationLink name="compactReplacer" />: empty arrays,
				<code>false</code> booleans, and <code>undefined</code> fields are stripped, so
				<code>optional</code>, <code>acceptsChildren</code>, <code>partial</code>,
				<code>rest</code>, <code>bindable</code>, and similar fields vanish at their default. The
				<code>value</code> key is exempt, so a <code>{`{kind: "literal", value: false}`}</code> type
				node survives. Parsing with <DeclarationLink name="parseAnalyzeResult" /> (or
				<DeclarationLink name="parseModuleJson" /> for one module) restores every default and
				validates the shape, so the round-trip is lossless. The helpers are the stable entry point;
				the <ModuleLink module_path="types.ts">valibot schemas</ModuleLink> behind them are exported
				too.
			</p>
			<p>
				Raw-JSON consumers (<code>jq</code>, pipelines that skip parsing) must treat <em>absent</em>
				as <em>false</em>: <code>decl.optional === false</code> fails because the key is gone. Parse
				first, or use truthiness checks like <code>if (decl.optional)</code>.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Examples" />
			<p>These show the compact wire form, so empty and default fields are stripped.</p>
			<p>A TypeScript function in <code>math.ts</code>:</p>
			<Code
				lang="ts"
				content={`/** Clamp a number to a range. */
export function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}`}
			/>
			<Code
				lang="json"
				content={`{
  "modules": [
    {
      "path": "math.ts",
      "declarations": [
        {
          "name": "clamp",
          "kind": "function",
          "docComment": "Clamp a number to a range.",
          "typeSignature": "(value: number, min: number, max: number): number",
          "sourceLine": 2,
          "parameters": [
            {"name": "value", "type": "number"},
            {"name": "min", "type": "number"},
            {"name": "max", "type": "number"}
          ],
          "returnType": "number"
        }
      ]
    }
  ]
}`}
			/>
			<p>
				A Svelte component <code>Card.svelte</code> with a snippet prop, children, an exported
				snippet, and a styling hook:
			</p>
			<Code
				lang="svelte"
				content={'<!-- @component A card with a customizable header. -->\n<' +
					`script lang="ts" module>
	/** Default footer snippet. */
	export {card_footer};
</script>

<` +
					`script lang="ts">
	import type {Snippet} from 'svelte';

	const {
		title,
		header,
		children,
	}: {
		title: string;
		/** Custom header rendering. */
		header?: Snippet<[title: string]>;
		children?: Snippet;
	} = $props();
</script>

<div class="card">
	{#if header}{@render header(title)}{:else}<h2>{title}</h2>{/if}
	{@render children?.()}
</div>

{#snippet card_footer(text: string)}
	<small>{text}</small>
{/snippet}

<style>
	.card {
		background: var(--card_bg, white);
	}
</style>`}
			/>
			<Code
				lang="json"
				content={`{
  "modules": [
    {
      "path": "Card.svelte",
      "declarations": [
        {
          "name": "Card",
          "kind": "component",
          "docComment": "A card with a customizable header.",
          "sourceLine": 7,
          "props": [
            {"name": "title", "type": "string"},
            {
              "name": "header",
              "type": "Snippet<[title: string]>",
              "typeInfo": {
                "kind": "reference",
                "name": "Snippet",
                "typeArgs": [
                  {
                    "kind": "tuple",
                    "elements": [
                      {"name": "title", "type": {"kind": "intrinsic", "text": "string"}}
                    ]
                  }
                ]
              },
              "optional": true,
              "description": "Custom header rendering.",
              "parameters": [
                {"name": "title", "type": "string"}
              ]
            },
            {"name": "children", "type": "Snippet<[]>", "optional": true}
          ],
          "acceptsChildren": true,
          "cssCustomProperties": [
            {"name": "--card_bg", "fallback": "white", "sourceLine": 33}
          ]
        },
        {
          "name": "card_footer",
          "kind": "snippet",
          "docComment": "Default footer snippet.",
          "typeSignature": "Snippet<[text: string]>",
          "sourceLine": 27,
          "parameters": [
            {"name": "text", "type": "string"}
          ]
        }
      ]
    }
  ]
}`}
			/>
			<p>A rune module <code>counter.svelte.ts</code> exporting reactive state:</p>
			<Code
				lang="ts"
				content={`export let count = $state(0);
export const doubled = $derived(count * 2);`}
			/>
			<Code
				lang="json"
				content={`{
  "modules": [
    {
      "path": "counter.svelte.ts",
      "declarations": [
        {
          "name": "count",
          "kind": "variable",
          "typeSignature": "number",
          "sourceLine": 1,
          "reactivity": "$state"
        },
        {
          "name": "doubled",
          "kind": "variable",
          "typeSignature": "number",
          "sourceLine": 2,
          "reactivity": "$derived"
        }
      ]
    }
  ]
}`}
			/>
			<p>
				A barrel <code>index.ts</code> that re-exports <code>clamp</code> from <code>math.ts</code>
				under a new name and star-exports <code>other.ts</code>. The rename synthesizes a
				declaration with <code>aliasOf</code> that inherits the canonical's signature and docs, the
				star export lands on <code>starExports</code>, and the dependency fields connect the
				modules. A same-name re-export would instead add the barrel to the canonical's
				<code>alsoExportedFrom</code>.
			</p>
			<Code
				lang="ts"
				content={`// index.ts
export {clamp as clampNumber} from './math.js';
export * from './other.js';

// other.ts
export const TAU = Math.PI * 2;`}
			/>
			<Code
				lang="json"
				content={`{
  "modules": [
    {
      "path": "index.ts",
      "declarations": [
        {
          "name": "clampNumber",
          "kind": "function",
          "docComment": "Clamp a number to a range.",
          "typeSignature": "(value: number, min: number, max: number): number",
          "sourceLine": 1,
          "aliasOf": {"module": "math.ts", "name": "clamp"},
          "parameters": [
            {"name": "value", "type": "number"},
            {"name": "min", "type": "number"},
            {"name": "max", "type": "number"}
          ],
          "returnType": "number"
        }
      ],
      "dependencies": ["math.ts", "other.ts"],
      "starExports": ["other.ts"]
    },
    {
      "path": "math.ts",
      "declarations": [
        {
          "name": "clamp",
          "kind": "function",
          "docComment": "Clamp a number to a range.",
          "typeSignature": "(value: number, min: number, max: number): number",
          "sourceLine": 2,
          "parameters": [
            {"name": "value", "type": "number"},
            {"name": "min", "type": "number"},
            {"name": "max", "type": "number"}
          ],
          "returnType": "number"
        }
      ],
      "dependents": ["index.ts"]
    },
    {
      "path": "other.ts",
      "declarations": [
        {"name": "TAU", "kind": "variable", "typeSignature": "number", "sourceLine": 1}
      ],
      "dependents": ["index.ts"]
    }
  ]
}`}
			/>
			<p>
				See the <ModuleLink module_path="types.ts">types module</ModuleLink> for the full schemas,
				and the <TomeLink slug="api">API reference</TomeLink> for all exported types.
			</p>
		</TomeSection>
	</section>
</TomeContent>
