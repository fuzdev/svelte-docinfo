<script lang="ts">
	import Code from '@fuzdev/fuz_code/Code.svelte';
	import TomeContent from '@fuzdev/fuz_ui/TomeContent.svelte';
	import TomeSection from '@fuzdev/fuz_ui/TomeSection.svelte';
	import TomeSectionHeader from '@fuzdev/fuz_ui/TomeSectionHeader.svelte';
	import ModuleLink from '@fuzdev/fuz_ui/ModuleLink.svelte';
	import DeclarationLink from '@fuzdev/fuz_ui/DeclarationLink.svelte';
	import TomeLink from '@fuzdev/fuz_ui/TomeLink.svelte';
	import {tome_get_by_slug} from '@fuzdev/fuz_ui/tome.js';

	const LIBRARY_ITEM_NAME = 'output-format';

	const tome = tome_get_by_slug(LIBRARY_ITEM_NAME);
</script>

<svelte:head>
	<title>output format - svelte-docinfo</title>
</svelte:head>

<TomeContent {tome}>
	<section>
		<p>
			svelte-docinfo outputs JSON describing your project's exported API. The data format is a
			hierarchy: modules contain declarations, and some declarations contain members or props.
		</p>

		<TomeSection>
			<TomeSectionHeader text="Top-level structure" />
			<p>
				Programmatic entry points (<DeclarationLink name="analyze" />,
				<DeclarationLink name="analyzeFromFiles" />) return both
				<code>modules</code> and accumulated <TomeLink slug="diagnostics" />:
			</p>
			<Code
				lang="ts"
				content={`{
  modules: ModuleJson[],
  diagnostics: Diagnostic[]
}`}
			/>
			<p>
				All surfaces emit this shape. The CLI's stdout JSON and the Vite plugin's virtual module
				both expose <code>modules</code> and <code>diagnostics</code> (matching
				<DeclarationLink name="AnalyzeResultJson" />). The CLI runs output through
				<DeclarationLink name="compactReplacer" /> so empty arrays strip on the wire (an empty-project
				run emits <code>{`{}`}</code>); parse JSON consumers through
				<DeclarationLink name="AnalyzeResultJson" /> to restore Zod defaults.
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
				<li><code>starExports</code>: <code>export * from './module'</code> patterns</li>
			</ul>
			<p>
				Array fields (<code>declarations</code>, <code>dependencies</code>, etc.) are omitted from
				JSON when empty and default to <code>[]</code> at runtime after parsing.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="DeclarationJson" />
			<p>
				Each declaration is a <DeclarationLink name="DeclarationJson" />, a discriminated union on
				the
				<code>kind</code> field with nine variants:
			</p>
			<ul>
				<li>
					<code>"function"</code>: adds <code>parameters</code>, <code>returnType</code>,
					<code>returnDescription</code>, <code>overloads</code>
				</li>
				<li>
					<code>"variable"</code>: adds optional <code>defaultValue</code> (from
					<code>@default</code>), plus <code>reactivity</code> when the initializer is a Svelte rune
					(<code>$state</code>, <code>$state.raw</code>, <code>$derived</code>,
					<code>$derived.by</code>)
				</li>
				<li>
					<code>"class"</code>: adds <code>members</code>, <code>extends</code>,
					<code>implements</code>
				</li>
				<li><code>"interface"</code>: adds <code>members</code>, <code>extends</code></li>
				<li><code>"type"</code>: adds <code>members</code>, <code>intersects</code></li>
				<li><code>"enum"</code>: adds <code>members</code> (enum values)</li>
				<li>
					<code>"component"</code>: adds <code>props</code>, <code>intersects</code>,
					<code>acceptsChildren</code>, <code>lang</code> (Svelte components)
				</li>
				<li>
					<code>"snippet"</code>: adds <code>parameters</code> (exported Svelte template snippets)
				</li>
				<li>
					<code>"namespace"</code>: adds <code>module</code> (the source module path projected under
					this binding); synthesized for <code>export * as ns from './x'</code>
				</li>
			</ul>
			<p>Shared fields on all variants:</p>
			<ul>
				<li>
					<code>name</code>, <code>kind</code>: identity. Default exports carry
					<code>name === "default"</code> (see Re-exports below)
				</li>
				<li><code>docComment</code>: JSDoc comment text</li>
				<li><code>typeSignature</code>: full type as a string</li>
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
					<code>mutates</code>: from the non-standard <code>@mutates</code> tag, stored as
					<code>Record&lt;string, string&gt;</code> mapping target keys to descriptions. Keys are
					typically parameter names but compound paths (<code>this.foo</code>) and external state
					references are accepted as-is
				</li>
				<li><code>alsoExportedFrom</code>: modules that re-export this declaration</li>
				<li><code>aliasOf</code>: original name if this is a renamed re-export</li>
				<li>
					<code>partial</code>: <code>true</code> when extraction failed partway through the declaration,
					indicating incomplete data
				</li>
			</ul>
			<p>
				Declarations tagged with <code>@nodocs</code> are excluded from the output entirely and are also
				excluded from duplicate name checking.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Re-exports" />
			<p>Re-exports are encoded with two shapes, chosen by content:</p>
			<ul>
				<li>
					<strong>Same-name</strong>: the canonical declaration carries an
					<code>alsoExportedFrom</code> array listing the modules that re-export it. One declaration,
					multiple import paths.
				</li>
				<li>
					<strong>Renamed</strong>: a synthesized declaration appears in the re-exporting module
					with <code>aliasOf: {`{module, name}`}</code> pointing at the canonical. Inherits
					<code>typeSignature</code>, <code>docComment</code>, <code>parameters</code>,
					<code>reactivity</code>, and <code>defaultValue</code> from the canonical;
					<code>sourceLine</code> is undefined.
				</li>
				<li>
					<strong>Star exports</strong>: <code>export * from './x'</code> patterns are tracked
					separately on <code>ModuleJson.starExports</code> and don't synthesize per-declaration entries.
				</li>
			</ul>
			<p>
				When a re-export statement carries its own JSDoc or <code>@nodocs</code>, an alias is
				<em>also</em> synthesized in the re-exporting module so the local content has somewhere to
				live, even when the name is unchanged. The trigger is "presence of local content," not
				"presence of rename." Local doc-comment fields apply first and stick; canonical fields only
				fill gaps. <code>@nodocs</code> on a re-export suppresses both the link and the synthesis.
			</p>
			<p>
				<strong>Default-slot entries</strong> carry <code>name === "default"</code> (see the
				shared-fields note above for why). Renames out of the default slot (<code
					>{`export {default as Foo} from './x'`}</code
				>) carry <code>name: "Foo"</code> and
				<code>aliasOf: {`{module, name: "default"}`}</code>. Duplicate-name checks skip
				<code>"default"</code> since the default slot is module-scoped per the JS spec.
			</p>
			<p>
				<strong>Namespace re-exports</strong> (<code>export * as ns from './x'</code>) synthesize a
				<code>NamespaceDeclarationJson</code> with <code>module</code> pointing at the source the
				namespace projects. Consumers render <code>ns.a</code> / <code>ns.b</code> by reading the
				source module's <code>declarations</code>; namespaces don't inline members.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="MemberJson" />
			<p>
				Classes, interfaces, types, and enums can contain <DeclarationLink name="MemberJson" /> entries
				in their <code>members</code> arrays. <code>MemberJson</code> is a discriminated union on
				<code>kind</code> with three variants:
			</p>
			<ul>
				<li>
					<code>"function"</code>: methods and call signatures. Adds <code>parameters</code>,
					<code>returnType</code>, <code>returnDescription</code>, <code>overloads</code>
				</li>
				<li>
					<code>"constructor"</code>: class constructors and construct signatures. Adds
					<code>parameters</code>, <code>overloads</code>
				</li>
				<li>
					<code>"variable"</code>: properties, accessors, and index signatures. Adds optional
					<code>defaultValue</code> (from <code>@default</code>), plus <code>reactivity</code> for class
					fields initialized with a Svelte rune
				</li>
			</ul>
			<p>
				Member <code>kind</code> is restricted to these three variants. Nesting is exactly one level deep:
				members never contain their own members.
			</p>
			<p>
				Member <code>name</code> is the user-chosen identifier in most cases, but three synthesized
				sentinels appear when no source identifier exists: <code>"constructor"</code> (class
				constructor), <code>"(construct)"</code> (construct signature on an interface or type
				alias), and <code>"(call)"</code> (call signature on an interface or type alias).
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="ComponentPropJson" />
			<p>
				Component declarations have a <code>props</code> array of
				<DeclarationLink name="ComponentPropJson" /> entries:
			</p>
			<ul>
				<li><code>name</code>, <code>type</code>: prop name and TypeScript type</li>
				<li><code>optional</code>: whether the prop is optional</li>
				<li><code>description</code>: from JSDoc on the prop</li>
				<li><code>defaultValue</code>: default value as a string, if present</li>
				<li>
					<code>bindable</code>: set when the prop is declared with the
					<code>$bindable()</code> rune, so <code>&lt;Foo bind:value /&gt;</code> is supported.
					Modeled here (not via the variable-level <code>reactivity</code> field) because
					<code>$props</code>/<code>$bindable</code> are component-prop concerns
				</li>
				<li>
					<code>parameters</code>: structured parameters for snippet-typed props (e.g.,
					<code>Snippet&lt;[text: string]&gt;</code>), absent for non-snippet props
				</li>
				<li>
					<code>examples</code>, <code>deprecatedMessage</code>, <code>seeAlso</code>,
					<code>throws</code>, <code>since</code>: symbol-scope JSDoc tags parsed from the prop's
					own doc comment (same shape as the declaration shared fields)
				</li>
			</ul>
			<p>
				<strong>Asymmetry with <DeclarationLink name="ParameterJson" />.</strong> Props carry the
				symbol-scope tag fields above; function parameters deliberately don't. A prop is a named
				slot with its own documentation surface. A parameter is positional, and its
				<code>@example</code>/<code>@deprecated</code>/<code>@since</code>/<code>@see</code>/<code
					>@throws</code
				>
				belong on the enclosing function symbol per the TSDoc spec. Per-parameter content lives on
				<code>ParameterJson.description</code>
				from <code>@param</code> only.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="ParameterJson" />
			<p>
				Functions, snippets, constructors, and snippet-typed component props use
				<DeclarationLink name="ParameterJson" /> entries in their <code>parameters</code> arrays:
			</p>
			<ul>
				<li>
					<code>name</code>: parameter name (e.g., <code>"options"</code>, <code>"...args"</code>)
				</li>
				<li><code>type</code>: resolved TypeScript type as a string</li>
				<li><code>optional</code>: whether the parameter has a <code>?</code> token</li>
				<li><code>rest</code>: whether the parameter uses rest syntax (<code>...args</code>)</li>
				<li><code>description</code>: from <code>@param</code> JSDoc</li>
				<li><code>defaultValue</code>: default value expression from the source, if present</li>
			</ul>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="OverloadJson" />
			<p>
				Functions and constructors with multiple signatures use
				<DeclarationLink name="OverloadJson" /> entries in their <code>overloads</code> arrays. Each overload
				captures only signature-scope content, the fields that can vary meaningfully per signature:
			</p>
			<ul>
				<li><code>typeSignature</code>: the full overload signature as a string</li>
				<li>
					<code>parameters</code>: parameter list for this overload, with per-overload
					<code>@param</code> descriptions
				</li>
				<li><code>returnType</code>: return type for this overload (functions only)</li>
				<li><code>genericParams</code>: type parameters for this overload</li>
				<li><code>docComment</code>: per-overload JSDoc text, if present</li>
				<li><code>returnDescription</code>: from <code>@returns</code> on this overload</li>
			</ul>
			<p>
				Symbol-scope JSDoc tags (<code>@example</code>, <code>@deprecated</code>,
				<code>@since</code>, <code>@see</code>, <code>@throws</code>, <code>@mutates</code>)
				describe the function as a whole and live on the parent declaration only, not duplicated per
				overload. The primary overload's JSDoc feeds the parent's symbol-level extraction; placing
				one of those tags on a non-primary overload signature emits a
				<code>misplaced_tag</code>
				warning and the tag is dropped (no synthetic content, no silent loss). Typo'd or stale
				<code>@param</code> keys produce <code>unknown_param</code> warnings the same way.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Reactivity" />
			<p>
				The <code>reactivity</code> field appears on <DeclarationLink
					name="VariableDeclarationJson"
				/>
				and <DeclarationLink name="VariableMemberJson" /> when the initializer is a value-producing Svelte
				rune call: <code>$state</code>, <code>$state.raw</code>, <code>$derived</code>, or
				<code>$derived.by</code>. Detection is purely syntactic and runs on every analyzed file
				regardless of extension, capturing the same patterns in a plain <code>.ts</code> file as in
				<code>.svelte.ts</code> or a component's <code>&lt;script&gt;</code>.
			</p>
			<p>
				It covers variables (top-level and class fields). Function parameters and destructured
				bindings are not annotated even when the value flows from a rune. <code>$props</code> and
				<code>$bindable</code> are component-prop concerns and surface on
				<DeclarationLink name="ComponentPropJson" />'s <code>bindable</code> field instead.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="GenericParamJson" />
			<p>
				Declarations and members with type parameters use
				<DeclarationLink name="GenericParamJson" /> entries in their
				<code>genericParams</code> arrays:
			</p>
			<ul>
				<li><code>name</code>: type parameter name (e.g., <code>"T"</code>)</li>
				<li><code>constraint</code>: <code>extends</code> constraint, if present</li>
				<li><code>defaultType</code>: default type, if present</li>
			</ul>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Working with type strings" />
			<p>
				Type signatures are opaque strings produced by the TypeScript compiler. To discover which
				in-project declaration names appear in a type string (e.g., for rendering clickable links),
				use <DeclarationLink name="findTypeReferences" />:
			</p>
			<Code
				lang="ts"
				content={`import {findTypeReferences} from 'svelte-docinfo';

const names = new Set(modules.flatMap(m => m.declarations.map(d => d.name)));
findTypeReferences('Map<string, ModuleJson[]>', names);
// => ['ModuleJson']`}
			/>
			<p>
				When scanning many type strings against the same set of names, pre-compile the patterns with
				<DeclarationLink name="buildTypeReferencePatterns" /> to avoid recompiling regexes on every call.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Compact JSON and absent-as-false" />
			<p>
				By default, output uses compact JSON via <DeclarationLink name="compactReplacer" />: empty
				arrays, <code>false</code> booleans, and <code>undefined</code> fields are stripped, so
				<code>optional</code>, <code>acceptsChildren</code>, <code>partial</code>,
				<code>rest</code>,
				<code>bindable</code>, and similar fields vanish from the wire form when their value is the
				default. After parsing with the Zod schemas from
				<ModuleLink module_path="types.ts">types.ts</ModuleLink> (or
				<DeclarationLink name="AnalyzeResultJson" /> for the full
				<code>{`{modules, diagnostics}`}</code> envelope), all defaults are restored, and the round-trip
				is lossless.
			</p>
			<p>
				Raw-JSON consumers (e.g., <code>jq</code>, hand-rolled pipelines that skip
				<code>.parse()</code>) must treat <em>absent</em> as <em>false</em>; a literal
				<code>decl.optional === false</code> check silently fails because the key is gone. Use the
				schemas, or truthy/falsy checks (<code>if (decl.optional) …</code>) on raw JSON.
			</p>
		</TomeSection>

		<TomeSection>
			<TomeSectionHeader text="Examples" />
			<p>A TypeScript function:</p>
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
          "parameters": [
            {"name": "value", "type": "number"},
            {"name": "min", "type": "number"},
            {"name": "max", "type": "number"}
          ],
          "returnType": "number",
          "sourceLine": 2
        }
      ]
    }
  ]
}`}
			/>
			<p>A Svelte component with a snippet prop, children, and an exported snippet:</p>
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
          "acceptsChildren": true,
          "props": [
            {"name": "title", "type": "string"},
            {
              "name": "header",
              "type": "Snippet<[title: string]>",
              "optional": true,
              "description": "Custom header rendering.",
              "parameters": [
                {"name": "title", "type": "string"}
              ]
            }
          ],
          "sourceLine": 1
        },
        {
          "name": "card_footer",
          "kind": "snippet",
          "docComment": "Default footer snippet.",
          "typeSignature": "Snippet<[text: string]>",
          "parameters": [
            {"name": "text", "type": "string"}
          ],
          "sourceLine": 12
        }
      ]
    }
  ]
}`}
			/>
			<p>A rune module exporting reactive state (e.g., a <code>.svelte.ts</code> file):</p>
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
          "reactivity": "$state",
          "sourceLine": 1
        },
        {
          "name": "doubled",
          "kind": "variable",
          "typeSignature": "number",
          "reactivity": "$derived",
          "sourceLine": 2
        }
      ]
    }
  ]
}`}
			/>
			<p>
				A function defined in <code>math.ts</code> and re-exported under a new name from the barrel
				<code>index.ts</code>. The canonical entry carries
				<code>alsoExportedFrom</code> if any module re-exports it under the same name. Renames
				synthesize a separate declaration with <code>aliasOf</code>:
			</p>
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
          "typeSignature": "(value: number, min: number, max: number): number",
          "sourceLine": 2
        }
      ]
    },
    {
      "path": "index.ts",
      "declarations": [
        {
          "name": "clampNumber",
          "kind": "function",
          "typeSignature": "(value: number, min: number, max: number): number",
          "aliasOf": {"module": "math.ts", "name": "clamp"}
        }
      ],
      "starExports": ["other.ts"]
    }
  ]
}`}
			/>
			<p>
				See the <ModuleLink module_path="types.ts">types module</ModuleLink> for the full Zod schemas,
				and the <TomeLink slug="api">API reference</TomeLink> for all exported types.
			</p>
		</TomeSection>
	</section>
</TomeContent>
