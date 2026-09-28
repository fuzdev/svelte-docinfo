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
				programmatic entry points (<DeclarationLink name="analyze" />,
				<DeclarationLink name="analyzeFromFiles" />), the CLI's JSON, and the Vite plugin's virtual
				module.
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
				<a href="#Compact-JSON-and-absent-as-false">compact JSON</a>, so an empty project prints
				<code>{`{}`}</code>; parse it through <DeclarationLink name="AnalyzeResultJson" /> to
				restore the defaults.
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
				<li><code>moduleComment</code>: file-level JSDoc comment, if present</li>
				<li><code>dependencies</code>: paths of modules this file imports</li>
				<li><code>dependents</code>: paths of modules that import this file</li>
				<li><code>starExports</code>: <code>export * from './module'</code> targets</li>
				<li>
					<code>reExports</code>: same-name re-export edges
					(<code>{`{name, module, typeOnly, sourceLine}`}</code>), the forward view of
					<code>alsoExportedFrom</code> (see <a href="#Re-exports">Re-exports</a>)
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
					<code>"variable"</code>: adds optional <code>defaultValue</code> (from
					<code>@default</code>) and <code>reactivity</code> (see
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
					<code>"type"</code>: adds <code>members</code>, <code>externalTypes</code>,
					<code>mergedValue</code>
				</li>
				<li><code>"enum"</code>: adds <code>members</code> (enum values)</li>
				<li>
					<code>"component"</code>: adds <code>props</code>, <code>externalTypes</code>,
					<code>acceptsChildren</code>, <code>lang</code> (Svelte components)
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
				when the type has none, and <code>@nodocs</code> on either declaration excludes the pair.
			</p>
			<p>Shared fields on all variants:</p>
			<ul>
				<li>
					<code>name</code>, <code>kind</code>: identity. Default exports carry
					<code>name === "default"</code> (see <a href="#Re-exports">Re-exports</a>)
				</li>
				<li><code>docComment</code>: JSDoc comment text</li>
				<li>
					<code>typeSignature</code>: the full type as a string, rendered by the TypeScript checker
					(see <a href="#Module-paths-in-type-text">module paths</a> below)
				</li>
				<li>
					<code>typeInfo</code>: a structured <DeclarationLink name="TypeJson" /> tree beside the
					flat string, on variables and type aliases (plus members, component props, parameters, and
					return types via <code>returnTypeInfo</code>). See
					<a href="#Structured-types-typeInfo">structured types</a> below
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
					exclusion (empty string for a bare tag). Declarations and members only, not component
					props
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
				Declarations tagged <code>@nodocs</code> are excluded from the output and from duplicate
				name checking.
			</p>

			<TomeSection>
				<TomeSectionHeader text="Module paths in type text" />
				<p>
					TypeScript prints a module object as <code>typeof import("…")</code> with an absolute
					path, from an <code>import()</code> expression or a <code>typeof</code> over a namespace
					import. svelte-docinfo rewrites the path so output never carries one:
				</p>
				<ul>
					<li>
						a module in this output is named by its <code>ModuleJson.path</code>, so the string
						doubles as a lookup key: <code>modules.find((m) =&gt; m.path === s)</code>, where a miss
						means it isn't a module here
					</li>
					<li>a package is named by its path below <code>node_modules/</code></li>
					<li>
						anything else is relative to the project root, with <code>../sibling/x.ts</code> for a
						file outside it
					</li>
				</ul>
				<p>
					This applies to <code>typeSignature</code>, <code>returnType</code>, member signatures,
					and <code>typeInfo</code> text. In a tree, a module object is a terminal
					<code>{`{kind: "other"}`}</code> node carrying that text, never a <code>reference</code>.
				</p>
			</TomeSection>

			<TomeSection>
				<TomeSectionHeader text="Structured types (typeInfo)" />
				<p>
					<code>typeInfo</code> is absent when the flat string says everything: intrinsics, bare
					references, object and function types. It is present when the tree adds structure: union
					and intersection <code>members</code> (alias names kept; enum members as
					<code>{`{value, text}`}</code> pairs with the qualified name as <code>text</code>),
					reference <code>name</code> and <code>typeArgs</code>, array <code>element</code>, and
					tuple <code>elements</code> (label, <code>?</code>/<code>...</code> markers, element
					type). Arrays and tuples mark <code>readonly</code>. The ten node kinds are
					<code>intrinsic</code>, <code>literal</code>, <code>reference</code>, <code>array</code>,
					<code>tuple</code>, <code>union</code>, <code>intersection</code>, <code>function</code>,
					<code>object</code>, and <code>other</code>.
				</p>
				<p>
					Object literal and function types stay terminal <code>text</code>. Anything callable is a
					<code>function</code> node, except a named generic instantiation, which is a
					<code>reference</code>: <code>Snippet&lt;[a: string]&gt;</code> is a reference whose tuple
					type argument carries real elements. An instantiation over the empty tuple
					(<code>Snippet&lt;[]&gt;</code>) adds nothing, so it stays absent.
				</p>
				<p>
					Type aliases relax the absence rule. A union alias's <code>typeSignature</code> prints as
					just its own name, so the tree is emitted whatever its shape to carry the members, except
					for object and function roots, which <code>members</code> already covers.
				</p>
				<p>
					<strong>Lost aliases.</strong> TypeScript drops the name of an alias whose right-hand side
					is an indexed access or conditional (<code>z.infer&lt;typeof S&gt;</code>, valibot's
					<code>InferOutput</code>) and expands its structure everywhere it's used. svelte-docinfo
					recovers the name as <code>{`{kind: "reference", name}`}</code> wherever the checker has
					none, from two sources: the type annotation written at that position, and a registry of
					the analyzed set's exported lost aliases. The registry also covers unannotated positions:
					inferred returns and variables, nested positions, and optional positions typed
					<code>T | null</code>.
				</p>
				<p>
					A registry-recovered reference also carries <code>module</code>, the declaring module's
					<code>ModuleJson.path</code>. It always names a module in the output, so a
					<code>(module, name)</code> lookup can't dangle; other references never carry it. Recovery
					applies at the root too, where the flat string still holds the expansion. Names the
					checker has are never overridden, import renames recover the importable name, and two
					aliases over one lost type resolve to a single winner everywhere. A loss that can't be
					recovered emits an <code>alias_lost</code> warning (see <TomeLink slug="diagnostics" />).
				</p>
			</TomeSection>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Re-exports" />
			<p>Re-exports are encoded by shape:</p>
			<ul>
				<li>
					<strong>Same-name</strong>: the canonical declaration's <code>alsoExportedFrom</code>
					lists the modules that re-export it: one declaration, several import paths. The
					re-exporting module lists the same edges on <code>ModuleJson.reExports</code>, with
					<code>module</code> naming the canonical module (resolved through chains), so barrels are
					self-describing.
				</li>
				<li>
					<strong>Renamed</strong>: a declaration is synthesized in the re-exporting module with
					<code>aliasOf: {`{module, name}`}</code> pointing at the canonical. It inherits the
					canonical's analyzed shape (<code>typeSignature</code>, <code>docComment</code>,
					<code>parameters</code>, and so on); <code>sourceLine</code> is the local export
					specifier's line.
				</li>
				<li>
					<strong>Star exports</strong>: <code>export * from './x'</code> lands on
					<code>ModuleJson.starExports</code>, with no per-declaration entries.
				</li>
				<li>
					<strong>Gated canonicals</strong>: re-exporting a symbol from a module excluded from
					output (e.g. <code>internal/</code>) synthesizes a full alias even when the name is
					unchanged, since the canonical module emits nothing to link. Its
					<code>aliasOf.module</code> names a module absent from output, and no
					<code>reExports</code> edge is emitted.
				</li>
				<li>
					<strong>External re-exports</strong>: statements that directly name a package
					(<code>{`export {x} from 'pkg'`}</code>, <code>export * as ns from 'pkg'</code>,
					<code>export * from 'pkg'</code>) land on <code>externalReExports</code> /
					<code>externalStarExports</code> with the specifier as written.
				</li>
			</ul>
			<p>
				A re-export statement with its own JSDoc also synthesizes an alias in the re-exporting
				module, even when the name is unchanged, so the local content has somewhere to live. Local
				doc fields win; the canonical's fields fill gaps. <code>@nodocs</code> on a re-export
				suppresses both the link and the synthesis.
			</p>
			<p>
				To get a module's complete export surface, call
				<DeclarationLink name="resolveExportSurface" /><code>(modules, path)</code>. It combines
				declarations, re-export edges, externals, and star exports with ES semantics (explicit
				exports shadow star-projected names, names ambiguous between stars are excluded,
				<code>default</code> never projects), and reports star targets whose names it can't know.
			</p>
			<p>
				<strong>Default-slot entries</strong> carry <code>name === "default"</code>, the symbol's
				JS-spec name. Renames out of the default slot
				(<code>{`export {default as Foo} from './x'`}</code>) carry <code>name: "Foo"</code> and
				<code>aliasOf: {`{module, name: "default"}`}</code>. Duplicate-name checks skip
				<code>"default"</code>, since each module has its own default slot.
			</p>
			<p>
				<strong>Namespace re-exports</strong> (<code>export * as ns from './x'</code>) produce a
				<code>"namespace"</code> declaration whose <code>module</code> names the projected source.
				Namespaces don't inline members; render <code>ns.a</code> by reading that module's
				<code>declarations</code>.
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
					<code>"variable"</code>: properties, accessors, and index signatures. Adds optional
					<code>defaultValue</code> (from <code>@default</code>), <code>typeInfo</code>, and
					<code>reactivity</code> for class fields initialized with a Svelte rune
				</li>
			</ul>
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
				<DeclarationLink name="ComponentPropJson" /> entries, in source order:
			</p>
			<ul>
				<li><code>name</code>, <code>type</code>: prop name and TypeScript type</li>
				<li>
					<code>typeInfo</code>: structured <DeclarationLink name="TypeJson" /> tree, when it adds
					structure
				</li>
				<li><code>optional</code>: whether the prop is optional</li>
				<li><code>description</code>: from JSDoc on the prop</li>
				<li><code>defaultValue</code>: default value as source text, if present</li>
				<li>
					<code>bindable</code>: set when the prop is declared with <code>$bindable()</code>, so
					<code>&lt;Foo bind:value /&gt;</code> works
				</li>
				<li>
					<code>parameters</code>: structured parameters for snippet-typed props (e.g.,
					<code>Snippet&lt;[text: string]&gt;</code>)
				</li>
				<li>
					<code>examples</code>, <code>deprecatedMessage</code>, <code>seeAlso</code>,
					<code>throws</code>, <code>since</code>: from the prop's own doc comment
				</li>
			</ul>
			<p>
				<DeclarationLink name="ParameterJson" /> deliberately lacks those tag fields: a prop is a
				named slot with its own documentation, while a parameter's <code>@example</code>,
				<code>@deprecated</code>, and similar tags belong on the enclosing function per the TSDoc
				spec. Parameters get their docs from <code>@param</code> only.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="ParameterJson" />
			<p>
				Functions, snippets, constructors, and snippet-typed props list
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
				<li><code>optional</code>: whether the parameter has a <code>?</code> token</li>
				<li><code>rest</code>: whether the parameter uses rest syntax (<code>...args</code>)</li>
				<li><code>description</code>: from <code>@param</code></li>
				<li><code>defaultValue</code>: default value expression from the source, if present</li>
				<li>
					<code>propertyDescriptions</code>: sub-path to description, from dotted
					<code>@param obj.prop</code> tags on a named object parameter (destructured parameters
					aren't covered)
				</li>
			</ul>
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
			<TomeSectionHeader text="Rendering structured types" />
			<p>
				Flat type signatures are opaque strings. Where a <code>typeInfo</code> or
				<code>returnTypeInfo</code> tree exists, flatten it with
				<DeclarationLink name="typeJsonToTokens" /> to render per node: link <code>name</code>
				tokens to declarations, syntax-highlight <code>code</code> tokens, and print
				<code>text</code> punctuation as-is.
			</p>
			<Code
				lang="ts"
				content={`import {typeJsonToTokens} from 'svelte-docinfo';

typeJsonToTokens(declaration.typeInfo);
// e.g. [{kind: 'name', name: 'Map'}, {kind: 'text', text: '<'},
//       {kind: 'code', text: 'string'}, {kind: 'text', text: ', '},
//       {kind: 'name', name: 'Tome'}, {kind: 'text', text: '>'}]`}
			/>
			<p>
				The tokenizer decides spacing, separators, parentheses, and tuple labels; the renderer
				decides what each token looks like. <DeclarationLink name="typeJsonToText" /> concatenates
				the same tokens into a plain string.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Compact JSON and absent-as-false" />
			<p>
				Output uses compact JSON via <DeclarationLink name="compactReplacer" />: empty arrays,
				<code>false</code> booleans, and <code>undefined</code> fields are stripped, so
				<code>optional</code>, <code>acceptsChildren</code>, <code>partial</code>,
				<code>rest</code>, <code>bindable</code>, and similar fields vanish at their default. The
				<code>value</code> key is exempt, so a <code>{`{kind: "literal", value: false}`}</code> type
				node survives. Parsing with the Zod schemas from
				<ModuleLink module_path="types.ts">types.ts</ModuleLink> (or
				<DeclarationLink name="AnalyzeResultJson" /> for the full envelope) restores every default,
				so the round-trip is lossless.
			</p>
			<p>
				Raw-JSON consumers (<code>jq</code>, pipelines that skip <code>.parse()</code>) must treat
				<em>absent</em> as <em>false</em>: <code>decl.optional === false</code> fails because the
				key is gone. Use the schemas, or truthiness checks like <code>if (decl.optional)</code>.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Examples" />
			<p>These show the compact wire form, so empty and default fields are stripped.</p>
			<p>A TypeScript function in <code>math.ts</code>:</p>
			<Code
				lang="ts"
				content={`/** Clamp a number to a range. */
export const clamp = (value: number, min: number, max: number): number =>
	Math.min(Math.max(value, min), max);`}
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
				A Svelte component <code>Card.svelte</code> with a snippet prop, children, and an exported
				snippet:
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
{/snippet}`}
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
          "acceptsChildren": true
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
				See the <ModuleLink module_path="types.ts">types module</ModuleLink> for the full Zod
				schemas, and the <TomeLink slug="api">API reference</TomeLink> for all exported types.
			</p>
		</TomeSection>
	</section>
</TomeContent>
