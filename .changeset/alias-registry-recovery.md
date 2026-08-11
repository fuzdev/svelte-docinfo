---
'svelte-docinfo': minor
---

feat: alias registry recovers lost alias names at unannotated positions; new `alias_lost` diagnostic

- A pre-pass registers the emitted modules' exported alias-lost type aliases
  (`z.infer<typeof S>`-class right-hand sides) by checker type identity.
  `typeInfo` now emits `{kind: 'reference', name}` at unannotated
  positions too — inferred returns and variables, nested tree positions,
  `Array<Lost>`/`Promise<Lost>` (trees flip from absent to structured), and
  `null`-bearing optionals via a member-set side index. Ambiguous aliases
  over one type resolve to a single global winner. Flat `typeSignature`
  strings are unchanged. `@nodocs`, gated (`internal/`), and generic aliases
  never register; a lost alias's own declaration keeps its structural tree.
- New `alias_lost` warning (query-time): an exported lost alias the registry
  can't recover, excluding literal-only unions (`z.enum`) and brand
  intersections — the residue is fixable author-side, e.g.
  `interface Foo extends z.infer<typeof S> {}`.
- Breaking for `@internal` subpath callers: the extractor seams take an
  `ExtractContext` (see the `exactOptionalPropertyTypes` changeset for the
  final field set and the `analyzeExports`/`analyzeTypescriptModule`
  signatures); `resolveTypeInfo`/`restElementForms`/`extractSnippetParameters`
  require an `AliasRegistry | undefined`; `analyzeSvelteModule`/`analyzeModule`
  accept an optional one. `isSvelte2tsxInternal` moved to `source.ts`.
