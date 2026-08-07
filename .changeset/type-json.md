---
'svelte-docinfo': minor
---

feat: structured type extraction — `TypeJson` via a new `typeInfo` field

Flat `checker.typeToString()` output can't carry union members, enum values,
or the named types inside generics — `type A = 'a' | 'b'` surfaced as just
`"A"`. A new optional `typeInfo` field (`TypeJson`, a recursive Zod schema)
sits beside the flat strings on `ComponentPropJson`, `ParameterJson` (snippet
tuple elements included), type-alias property members (index signatures
included), checker-backed class members (inferred properties, getter-backed
accessors), and variable/type-alias declarations:

- unions and intersections recurse into `members`, keeping the alias name;
  union members mirror the flat string's printed order (nullish last), and a
  written sub-alias survives as a nested alias-carrying node (`E | null`
  keeps `E`, an optional nullable alias keeps its alias) — recovered from the
  same internal `origin` field the printer reads, validated with fallback to
  the checker's normalized list
- enum members carry the runtime `value` with the qualified name as `text`
  (`value: 'a'`, `text: 'E.A'`) — a ready-made `{value, label}` pair
- named references keep `name` plus recursive `typeArgs` (`Map<string, B>`
  exposes `B` as a linkable node); arrays carry `element`
- object literals and function types stay terminal `text`, printed with
  `NoTruncation` (the flat strings keep the checker's canonical rendering).
  Anything with a call signature is a function node, callable interfaces
  included, so `Snippet<[...]>` is terminal text rather than a reference

`typeInfo` is absent when the flat string is the whole story (intrinsics,
bare references, object/function types at the root). Type aliases are the
exception: the checker prints an aliased type as its bare alias name, so
`type A = string[]` has `typeSignature: "A"` and nothing else — there the
tree is emitted whatever its shape, with terminal roots reprinted via
`InTypeAlias` (`type A = [string, number]` carries the tuple text, not
`"A"`). Object and function roots stay absent, since `members` already
carries their content.

Normalization matches the flat strings: the optional-widening `undefined` is
dropped and `true | false` collapses back to `boolean`; recursion is
depth-capped, degrading to `{kind: 'other', text}`. Checker-backed paths
only — AST-backed members (annotated interface and class properties,
setter-only accessors) report written text without it. `compactReplacer` now
exempts the `value` key from `false`-stripping, since a literal `false` node
is data, not a defaulted flag.
