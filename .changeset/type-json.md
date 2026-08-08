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
accessors), and variable/type-alias declarations, plus `returnTypeInfo`
beside `returnType` on function declarations/members and per overload:

- unions and intersections recurse into `members`, keeping the alias name;
  union members mirror the flat string's printed order (nullish last), and a
  written sub-alias survives as a nested alias-carrying node (`E | null`
  keeps `E`, an optional nullable alias keeps its alias) — recovered from the
  same internal `origin` field the printer reads, validated with fallback to
  the checker's normalized list
- enum members carry the runtime `value` with the qualified name as `text`
  (`value: 'a'`, `text: 'E.A'`) — a ready-made `{value, label}` pair
- named references keep `name` plus recursive `typeArgs` (`Map<string, B>`
  exposes `B` as a linkable node); arrays carry `element`; tuples carry
  structured `elements` (`TupleElementJson`: label, `?`/`...` markers,
  recursive type — an optional element strips the widening `undefined` so
  `optional: true` carries it alone, a rest element carries the printed
  array form); arrays and tuples mark `readonly` — the one place it
  survives at an alias root, whose flat string is just the alias name
- object literals and function types stay terminal `text`, printed with
  `NoTruncation` (the flat strings keep the checker's canonical rendering).
  Anything with a call signature is a function node — except *named generic
  instantiations* (checker `Reference`-flagged, symbol-named,
  argument-carrying), which classify as references, so `Snippet<[a: string]>`
  is a reference whose tuple typeArg carries real elements; bare signatures,
  aliased function types (`Handler`), and anonymous/hybrid callables —
  non-generic callable interfaces included — stay `function` — callability is
  the load-bearing renderer signal

`typeInfo` is absent when the flat string is the whole story (intrinsics,
bare references, object/function types at the root; arrays and tuples
qualify when an element does, and a reference qualifies on any type argument
that says something — so an instantiation over the empty tuple, `Snippet<[]>`
or bare `Snippet`, stays absent while `Snippet<[a: string]>` doesn't). Type
aliases are the exception: the checker
prints an aliased type as its bare alias name, so `type A = string[]` has
`typeSignature: "A"` and nothing else — there the tree is emitted whatever
its shape, with terminal roots reprinted via `InTypeAlias` (a conditional
alias carries its conditional text, not its own name). Object and function
roots stay absent, since `members` already carries their content.

Also fixes the optional-widening strip for types that absorb `undefined`
rather than unioning with it: `a?: unknown` reported `type: "{}"` (via
`checker.getNonNullableType`, which answers `{}` for `unknown`) and now
reports `"unknown"`. Properties and parameters both; `a?: any` was already
correct by coincidence. The strip now runs only on unions, where the widening
is a member there is something to remove.

Normalization matches the flat strings: the optional-widening `undefined` is
dropped and `true | false` collapses back to `boolean`; recursion is
depth-capped, degrading to `{kind: 'other', text}`. Checker-backed paths
only — AST-backed members (annotated interface and class properties,
setter-only accessors) report written text without it. `compactReplacer` now
exempts the `value` key from `false`-stripping, since a literal `false` node
is data, not a defaulted flag.

Breaking: `isSnippetTypeString(typeString)` (on the `svelte.js` subpath) is
replaced by the structural `isSnippetType(type, checker)` — snippet detection
now reads the resolved checker type (a callable `Snippet`-named `Reference`
instantiation) wherever one exists; `isSnippetReturnType` remains the
string-based detector for the svelte2tsx return brand. Detection semantics
shift with the shape check: `isSnippetType` checks the bare shape
(`acceptsChildren` walks union and intersection branches itself, so
intersection-wrapped `children` still count) and is looser on naming (an
alias over a `Snippet` instantiation now matches, so aliased snippet props
gain `parameters` — their `typeInfo` stays a bare-reference absence per the
alias policy, so don't key snippet rendering off `typeInfo` presence).
Snippet `parameters` also now
take tuple labels from parameter-derived elements (`Snippet<Parameters<F>>`),
matching the `typeInfo` tree instead of falling back to `arg0`/`arg1`, and
report rest elements faithfully — `rest: true` with the printed array form
(`...rest: B[]` carries `B[]` and an array `typeInfo` node) where they
previously carried `rest: false` and the bare element type;
`synthesizeSnippetTypeSignature` renders the `...` marker.
