---
'svelte-docinfo': minor
---

feat: structured type extraction — `TypeJson` via `typeInfo`/`returnTypeInfo`

Flat `checker.typeToString()` output can't carry union members, enum values,
or the named types inside generics — `type A = 'a' | 'b'` surfaced as just
`"A"`. A new optional `typeInfo` field (`TypeJson`, a recursive Zod schema)
sits beside the flat strings on component props, parameters (snippet tuple
elements included), type-alias and interface property members (index
signatures included), class members, and variable/type-alias declarations,
plus `returnTypeInfo` beside `returnType` on functions and per overload:

- unions/intersections recurse into `members`, keeping the alias; union
  members follow the flat string's printed order (nullish last) and written
  sub-aliases survive as nested nodes (`E | null` keeps `E`)
- enum members carry `{value, text}` pairs (`value: 'a'`, `text: 'E.A'`)
- references keep `name` plus recursive `typeArgs`; arrays carry `element`;
  tuples carry `elements` (label, `?`/`...` markers, recursive types); arrays
  and tuples mark `readonly` when written so
- object literals and function types stay terminal `text`, printed with
  `NoTruncation` up to a 1000-char budget, past which the checker's elided
  rendering is used — always a well-formed type string
- written-name recovery: where TypeScript dropped a type's alias (indexed
  access / conditional right-hand sides — `z.infer<typeof S>`, valibot's
  `InferOutput`), bare references in the written annotation resolve by
  checker type identity and emit `{kind: 'reference', name}` instead of the
  expansion — `(): Promise<AnalyzeResultJson>` documents as named references,
  not a multi-thousand-char dump. Applies to return types (per overload),
  parameters, variables, type-alias declarations and properties, index
  signatures, accessors, component props, and snippet parameters; the flat
  strings keep the checker's rendering
- anything with a call signature is a `function` node, except named generic
  instantiations (`Snippet<[a: string]>`), which classify as `reference` with
  `typeArgs`

`typeInfo` is absent when the flat string is the whole story (intrinsics,
bare references, object/function roots). Type-alias roots relax it — the
checker prints an aliased type as its bare name, so the tree is emitted
whatever its shape. Recursion is depth-capped, degrading to
`{kind: 'other', text}`; written-name recovery still fires at the cap.
`compactReplacer` exempts the `value` key from `false`-stripping so a literal
`false` node survives the wire.

Member `typeSignature`s are checker-backed everywhere now (previously raw
AST text at annotated interface/class properties, index signatures, and
setter-only accessors): canonical rendering (`Array<Foo>` prints `Foo[]`,
import renames resolve to the importable name, the optional-widening strip
applies — `a?: unknown` now reports `"unknown"` and a bare type parameter
reports `"E"`), string/numeric-literal member names document unquoted on
every container kind, `readonly` index signatures keep the modifier, a
callable property classifies `kind: 'function'` with full signature fields
(class fields stay `kind: 'variable'`), a generic callable property carries
`genericParams`, and `@default` on a callable-classified property drops with
a `misplaced_tag` warning instead of crashing `ModuleJson.parse`.

Breaking: `isSnippetTypeString(typeString)` is replaced by the structural
`isSnippetType(type, checker)`; an alias over a `Snippet` instantiation now
matches, so aliased snippet props gain `parameters`. Snippet `parameters`
take tuple labels from parameter-derived elements and report rest elements
faithfully (`rest: true` with the printed array form);
`synthesizeSnippetTypeSignature` renders the `...` marker.
