# svelte-docinfo

## 0.6.0

### Minor Changes

- feat: alias registry recovers lost alias names at unannotated positions; new `alias_lost` diagnostic ([#26](https://github.com/fuzdev/svelte-docinfo/pull/26))

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

- **breaking:** `ClassDeclarationJson.extends` is an array ([#39](https://github.com/fuzdev/svelte-docinfo/pull/39))

  Was `string | undefined`; now `Array<string>` with 0 or 1 entries
  (TypeScript allows one base class): `"extends": "Base"` → `"extends":
["Base"]`, with `.default([])` like the other array fields so empty arrays
  strip on the wire and `.parse()` restores them. Every heritage field —
  class `extends`/`implements`/`externalTypes`, interface
  `extends`/`externalTypes` — now shares one shape, so consumers iterate
  heritage uniformly instead of branching on declaration kind or normalizing
  with `Array.isArray`. Entries stay verbatim own-clause text.

- feat: `defaultValue` on function members and JSDoc/TSDoc tag spelling synonyms ([#23](https://github.com/fuzdev/svelte-docinfo/pull/23))

  - `FunctionMemberJson` gains optional `defaultValue`: `@default` on a member
    of any container kind now lands there — callable properties
    (`fn: () => void`), method shorthands (`fn(): void`), class methods —
    documenting the behavior used when the callback is omitted. Previously only
    variable-classified members carried the tag, so the same callable option
    documented or silently lost its default depending on spelling and
    container. Top-level function declarations, overloads, and constructors
    still never carry one; `@default` on a non-primary overload keeps its
    `misplaced_tag`. `applyToDeclaration` gains an optional `isMember`
    parameter gating the widened field. Consumers rendering `defaultValue`
    behind a `kind === 'variable'` check should widen it to function members.
  - Divergent JSDoc/TSDoc spellings parse as synonyms everywhere the tags land
    (component props included): `@return` like `@returns`, and `@defaultValue`
    (TSDoc) / `@defaultvalue` (JSDoc) like `@default` — previously all three
    were silently ignored. The docs' tags page now describes the supported set
    as the common JSDoc/TSDoc doc tags instead of "a subset of TSDoc" (whose
    `@defaultValue` wasn't parsed while the JSDoc-only `@default` was).

- fix: respect `exactOptionalPropertyTypes` — stop stripping author-written `undefined` from optional properties ([#38](https://github.com/fuzdev/svelte-docinfo/pull/38))

  - Under the flag the checker never widens optional properties, so every
    `undefined` there is author-written — extraction now reads the flag off
    the program and skips the optional-widening strip at property sites
    (component props, type-alias/interface/class properties), flat strings
    and `typeInfo` trees together. Previously `x?: T | undefined` shipped as
    `"T"`, `x?: T | null | undefined` as `"T | null"`, and `tp?: E | F` was
    corrupted to `"(E & {}) | (F & {})"` by the strip's `getNonNullableType`
    fallback.
  - Callability classification is unchanged by the flag: the callability
    query strips the optional `undefined` in both modes, so a written
    `fn?: (() => void) | undefined` — the spelling the flag forces when a
    possibly-`undefined` handler is assigned to the property — classifies
    `kind: 'function'` like `fn?: () => void`, keeping
    `parameters`/`returnType` and `@param`/`@returns` routing. At an optional
    position an explicit `undefined` is the same runtime observation as
    absence, already carried by `optional: true`; on a callable member that
    flag is also all that survives of the written `undefined` — the signature
    prints without it. `| null` still demotes to `kind: 'variable'` — `null`
    is a real value absence doesn't imply — as does a _required_ property's
    written `undefined` (`fn: (() => void) | undefined`), which has no
    `optional: true` to carry it.
  - Optional parameters and tuple elements keep widening under the flag (it
    governs properties only), so their strips stay unconditional. With the
    flag off, output is unchanged. Note the `getNonNullableType` rewrite above
    still applies at those two positions in both modes — `(c?: E | F)` reports
    `"NonNullable<E> | NonNullable<F>"` — since the flag can't gate a strip
    that genuinely has widening to remove.
  - Breaking for `@internal` subpath callers: `ExtractContext` gains a
    required `exactOptionalPropertyTypes: boolean`, and `analyzeExports` /
    `analyzeTypescriptModule` take the pass's `ExtractContext` in place of
    `(checker, diagnostics, aliasRegistry)` — built by
    `analyzeModule`/`analyzeSvelteModule` via the new `createExtractContext`
    (`typescript-extract-shared.ts`), which owns the fields derived from the
    program and options; direct callers construct their own.

- **breaking:** rename `intersects` to `externalTypes`, put it on interfaces and ([#34](https://github.com/fuzdev/svelte-docinfo/pull/34))
  classes, and make membership and attribution one model

  `TypeDeclarationJson.intersects` and `ComponentDeclarationJson.intersects` are
  now `externalTypes`. The field long since stopped matching its name: it has
  covered bare references and indexed access alongside intersections for some
  time, and now heritage clauses and the local composition behind them. What it
  lists is the external types whose contributions are filtered out of `members` /
  `props`, however the author composed them. Consumers rename the field; the
  shape (`Array<string>`, default `[]`) is unchanged.

  `InterfaceDeclarationJson` and `ClassDeclarationJson` gain the same field. The
  common library shape — export the props interface _and_ use it in the component
  — used to give two answers in one module: the component resolved through local
  bases transitively while the exported interface beside it showed only its
  verbatim `extends`, which dead-ends when the base is local and unexported.
  Interface and class members are own-only, so nothing is filtered there; the
  field names the external types the heritage composition reaches whose
  contributions `members` therefore never enumerates. Classes walk `extends`
  only — an implemented interface adds no members. `extends` / `implements` are
  unchanged verbatim own-clause text; on direct external heritage the two fields
  are textually equal by design, and consumers that render both dedupe at
  display time.

  ### Membership: one rule at every granularity

  External filtering used to be three mechanisms that disagreed — named
  properties filtered everywhere, index signatures only inside intersections,
  call/construct signatures not at all — so `type P = ExtCallable & {a}`
  emitted the package's `(call)` as a member and `type P = ExtIndexOnly`
  emitted the external index signature at a bare root, each with no
  `externalTypes` entry to account for it.

  One rule now decides membership: a contribution — named property, index
  signature, call/construct signature — is dropped when its declaration lives in
  an external file, at roots, in intersections (tested per constituent, since
  merging two same-kind index signatures loses the declaration), and through
  inheritance alike. Declaration-less contributions are kept: the checker
  synthesizes mapped-instantiation index infos (`Record<string, X>`,
  `Partial<Indexed>`, hand-written mapped types) with no declaration, and their
  content flows from the written site.

  The `externalTypes` leaf test is that same predicate applied per branch —
  recorded when the branch's declared contributions are wholly external and at
  least one exists — so a purely structural external branch (index-signature-only,
  callable-only) is attributable where it used to vanish, declaration-less
  contributions stay neutral in both directions, and membership and attribution
  can't disagree.

  Interfaces get the companion coherence fix: call/construct signatures are
  own-only like every other interface member kind — `interface I extends
ExtCallable` used to enumerate the bag's `(call)` while enumerating none of
  its properties. A signature's TSDoc now resolves through its own declaration
  like the type-alias path, so a signature written in a merged `interface`
  block keeps its docs.

  ### Attribution: what the walk records

  The labels come from an AST walk of the written type, so the `&` /
  index-access text is preserved verbatim. Membership filtering is
  inheritance-blind, so the walk is too — a leaf naming a **project-local** type
  descends through that type's own composition, transitively, and contributes
  whatever bags that reaches:

  - a local interface's `extends` entries, a local alias's right-hand side, a
    local class's `extends` chain, imports followed to the declaring module — so
    `interface Props extends HTMLButtonAttributes` records the bag exactly like
    `type Props = HTMLButtonAttributes & {…}`, including behind an intermediate
    local type or a props type imported from a sibling module
  - an indexed access over a _local_ container descends to the accessed
    property's written type: `type P = LocalMap['a']` records the bag the
    property holds rather than emitting the container's own (possibly
    unexported) name, single string/numeric-literal indices supported. An
    external container is unchanged — `SvelteHTMLElements['li']` stays the right
    single entry
  - the root is walked as written, so a bare reference to a local alias reaches
    the leaf fallback with its written type arguments intact

  Only when the descent comes back empty does a leaf fall back to its own text,
  and then only if wholly external by the leaf test. External names are never
  descended into (an external base chain stays one entry, no node_modules-internal
  definition leaks), and a local name surfaces only when it hides a definition the
  walk can't traverse — a mapped or conditional type.

  Two normalizations make an entry mean the same thing at the documented site as
  where it was written, both textual and identifier-scoped so written argument
  lists and the field's `&` / index-access shape survive:

  - **Import renames resolve to the exported name.** `import type {Bag as B}`
    beside `type Props = B & {…}` recorded `B`, a spelling that means nothing
    outside the file that wrote it. Resolution is one hop, deliberately: the
    full alias chain ends at the declaration's own name, which a package
    re-exporting under a new name (`export {Foo as Bar}`) never makes
    importable. A default import has no exported name to recover and is left
    alone.
  - **Type parameters bound inside the descent substitute their written
    argument.** `interface A<T> extends ExtG<T>` reached via `Props extends
A<string>` records `ExtG<string>`, not the wrapper's name. Arguments render
    at their own site first (outer substitutions and renames applied) so
    chained generics compose; an omitted argument takes its declared default. A
    parameter with neither still degrades to no entry rather than emitting text
    that dangles at the documented site.

  A type parameter in scope at the annotation site itself — a generic component's
  own — still emits as written, beside the `genericParams` documenting it.
  Descending in preference to the name is what keeps a local name out of a field
  that names external contributors: an attribute-forwarding `interface Props
extends Bag {}`, every property inherited, records `Bag` rather than `Props`.
  Each distinct contributor appears once, in source order. Entries carry no
  module, so the dedupe that collapses one bag spelled two ways also collapses two
  _distinct_ bags sharing an exported name; membership is unaffected either way.

  The descent is cycle-safe and depth-bounded; past the bound the reference in
  hand names itself, the degradation an untraversable definition already gets.
  Scoping note: an interface's or class's own field reads the processed
  declaration's heritage clauses — the same node `extends` and `members` come
  from — so on a merged interface only the selected block contributes, while a
  _reference_ to that interface descends every block.

  ### Local generic instantiations extract members

  `hasExtractableProperties` gated out every Reference-flagged non-mapped type to
  keep `Array<T>` / `Promise<T>` prototype surfaces out of `members`, which also
  swallowed instantiations of the project's _own_ generic types: `type X =
LocalGen<string>` emitted no members, and when the generic base reached an
  external bag (`interface LocalGen2<T> extends ExtNamed`), the early return ran
  before external filtering, so one type parameter erased the whole declaration —
  no members, no `externalTypes`, no diagnostic, while the non-generic twin
  documented fully.

  The gate now admits generic references whose target declarations are all
  project-local: instantiated members extract (`a: T` documents as `a: string`)
  and external filtering runs. External targets stay gated — a lib type's
  prototype surface is not the author's shape.

  ### Class visibility follows the class through an alias

  `private` and `#` members are excluded from a class's own `members`, but a
  structural container naming that class projected its _type_, which has no such
  filter — `type X = LocalClass` published `secret` and `#hard` beside the public
  shape, and admitting local generic instantiations extended that to
  `type X = LocalGen<string>`. Both paths now share one rule, so an alias hides
  exactly what the class hides; `protected` stays on both, as part of the
  extension API. Only classes can declare either form, so nothing else changes.

  Breaking for `@internal` subpath callers: `filterExternalProperties` →
  `filterDocumentedProperties`, `collectExternalTypesFromHeritage` →
  `applyHeritageExternalTypes`.

- feat: resolve dependency edges for in-memory files; add `ImportResolver.invalidate()` ([#37](https://github.com/fuzdev/svelte-docinfo/pull/37))

  `ModuleJson.dependencies` / `dependents` silently omitted edges whenever the
  target's content lived only in memory — a build tool handing over transformed
  source, an unsaved editor buffer, any `analyze()` input with no disk
  counterpart. The session served that content to the checker, so types resolved
  and nothing warned; only the graph was wrong. Three causes, each fixed:

  - **The default resolver ran against `ts.sys`.** It now resolves through a
    host that answers from the session's owned set plus the in-flight batch
    (dependency resolution runs before a batch commits, so a batch must resolve
    against itself), and the `.svelte` fallback — which TypeScript can never
    resolve on its own — probes the same host, so in-memory components find each
    other. `createDefaultResolver` takes that host as an optional third argument;
    it defaults to `ts.sys`, so disk-only callers are unaffected.
  - **Directory probes answered from disk.** TypeScript asks whether a directory
    exists before trying any file inside it, and treats "no" as "every candidate
    in here failed" without ever calling `fileExists` — so a file in a directory
    the disk doesn't have was unresolvable for the _checker_ too, its imports
    typed as errors with no diagnostic. Both the one-shot and language-service
    hosts now answer from the files they serve as well as the disk.
  - **A specifier that resolved to nothing stayed that way.** The resolver's
    cache stores failed lookups and lived as long as the session, and the
    session's own entry cache is keyed on content — so creating a file that an
    existing module already imports left the edge missing until the importer
    itself was next edited, which is the wrong trigger: the file that changed is
    the dep. That is the shape every watcher-driven consumer has. Resolver caches
    are now dropped when the owned set gains or loses a path, and a `setFiles`
    that adds paths retries the unresolved specifiers of already-owned entries,
    updating their edges and retiring any `resolver_failed` that has since
    resolved. Files whose imports all resolved cost nothing, and pre-resolved
    callers are untouched — their edges are theirs to declare.

  `ImportResolver` gains an optional `invalidate()` for the first of those:
  implement it if your resolver caches failed lookups, and the session will call
  it when its file set changes shape. Resolvers that don't cache need nothing.

- feat: the `src/lib/internal/` convention — default `**/internal/**` exclude, exclude-callback overrides, and null-exports blocking ([#22](https://github.com/fuzdev/svelte-docinfo/pull/22))

  Internal modules ship in a package for public modules to import but aren't
  part of the public surface. Three coordinated changes support the convention
  (gro's exports generation emits the matching `"./internal/*": null` blocker):

  - `DEFAULT_SOURCE_OPTIONS.exclude` gains `'**/internal/**'` — `internal/`
    directories are excluded from discovery and analysis by default. Breaking
    for projects documenting an `internal/` directory: re-include it with the
    new callback form
    (`exclude: (defaults) => defaults.filter((p) => p !== '**/internal/**')`).
  - The exclude override surfaces (`createSourceOptions` overrides,
    `analyzeFromFiles`'s `exclude`/`sourceOptions`, the Vite plugin) accept
    `ExcludeOption`: an array replaces the defaults wholesale (unchanged), a
    `(defaults) => patterns` callback extends them without restating them —
    closing the footgun where any custom `exclude` silently dropped the test
    filters. New exported types `ExcludeOption` and `SourceOptionsOverrides`;
    option types previously written as `Partial<SourceOptionsDefaults>` now use
    `SourceOptionsOverrides`. The CLI's `--exclude` stays array-only.
  - Exports-based discovery honors null-target exports keys with Node's
    resolution semantics (exact-key-wins, then `PATTERN_KEY_COMPARE`
    best-match). Previously null entries were skipped and the generic wildcards
    leaked the "blocked" files into discovery; now a subpath whose
    most-specific matching key resolves nothing — a literal `null`, or any
    object-ish value with no usable target (all-null/empty conditions object,
    fallback array with no usable element) — is never discovered, a more
    specific positive key still beats a broader null key, and concrete
    positive entries are never blocked. `ParsedExports` gains a `blocked`
    array, interpreted by the newly exported `createBlockedSpecifierChecker`
    (a naive membership check is wrong for wildcard keys).

  Plus the follow-through that keeps the convention live end-to-end:

  - **Sessions own the context closure** — new
    `AnalysisSessionOptions.contextClosure` (default `true`; `analyze()` opts
    out, `analyzeFromFiles` and the CLI keep it on): after each ingest batch
    the session reads from disk the in-root non-source files the batch's
    imports resolved to (transitively; `node_modules`/dot-dir segments and
    analyzer-less files excluded) and owns them as version-tracked context
    files. Output is
    unchanged — `query()` still gates them — but their edits now propagate: the
    Vite plugin's watcher gate widened to `isSource(file) || session.has(file)`,
    so editing an `internal/` module re-analyzes the public modules that use it
    instead of serving stale types until a dev-server restart.
  - **Stale-AST fix** — the first `setFile` of a file the session had
    previously resolved from disk was a silent no-op (a version collision in
    the language-service host), serving the stale AST despite new content.
  - **Re-exports from gated modules synthesize instead of misclassifying** —
    re-export classification now splits externality (`createIsExternalPath`,
    newly exported from `svelte-docinfo/typescript-program.js`) from the source
    gate. Previously `export { x } from './internal/helper.js'` landed in
    `externalReExports` with a relative path as its "package" specifier and the
    public name vanished from docs; now the re-exporting module synthesizes a
    full alias declaration (same-name, renamed, and import-then-export forms —
    including a same-name chain through a gated rename hop over a source
    canonical; namespace re-exports classify as namespaces; star exports from
    gated modules land in `starExports` and surface as
    `unresolvedStarExports`).
    `aliasOf` is kept for provenance and duplicate dedupe; its `module` may
    reference a module absent from output — a documented margin. Gated Svelte
    component re-exports document with full props: gated Svelte virtuals are
    analyzed as canonical-fill context at query time (`resolveComponentAliases`
    gains an optional lookup-only `contextModules` argument), so the filled
    alias tracks internal component edits live under the Vite plugin.
  - **Fallback-array exports values parse** — `parsePackageExports` takes the
    first usable element of an array target, so array-valued keys are real
    positive entries: discovered directly, and never out-matched by a broader
    null wildcard (previously they were skipped entirely, and under blocking
    they failed closed against the fail-open intent).
  - `getDefaultAnalyzer` is exported from the main barrel so custom
    `getAnalyzerType` implementations extend the default table by delegation
    instead of restating it.

- feat: `internalMessage` from the `@internal` tag on declarations and members ([#29](https://github.com/fuzdev/svelte-docinfo/pull/29))

  All declaration variants and member kinds gain optional `internalMessage`,
  mirroring `deprecatedMessage`: presence means the tag was written, an empty
  string is a bare tag, and trailing prose (`@internal used during development`)
  is the value — previously tag and prose vanished silently. A marker, not an
  exclusion: the declaration stays documented (`@nodocs` remains the exclusion
  tag). Symbol-scope like `@deprecated`: on a non-primary overload it emits
  `misplaced_tag` (whose `tagName` enum gains `'internal'`) and is dropped.
  Deliberately not on `ComponentPropJson`.

- fix: detect legacy `export let` components instead of failing silently ([#13](https://github.com/fuzdev/svelte-docinfo/pull/13))

  Runes-less components (still-legal Svelte 5 syntax) have no `$props()`
  declaration to anchor prop extraction on, so they produced zero props with no
  diagnostic — and the first documented `export let`'s JSDoc leaked into the
  component `docComment`. Now:

  - a new `legacy_props` warning diagnostic reports the component and its
    legacy prop names (`export let`/`export var` declarations plus
    export-clause renames of mutable bindings like `export {a as b}`;
    `export const`/`export function` accessors and type-only exports are not
    props and stay silent), with `line` pointing at the first legacy export in
    the original `.svelte` source
  - the in-script `docComment` walk is gated on the `$props()` anchor: with no
    `$props()`, the HTML `@component` comment is the only `docComment` source.
    Besides the legacy leak, this also fixes propless runes components, where a
    documented local (`/** ... */ let a = $state(0)`) could claim the component
    doc slot

  Legacy props are still not extracted — migrate to `$props()` for prop
  extraction.

- feat: merged value+type symbols document the type meaning, marked `mergedValue` ([#24](https://github.com/fuzdev/svelte-docinfo/pull/24))

  - A merged value+type export (`const Foo = z.strictObject({...})` +
    `type Foo = z.infer<typeof Foo>`, the schema/type pattern; `const X` +
    `interface X` likewise) now documents the type meaning — structure,
    `members`, `typeInfo`, like the un-merged equivalent — instead of the
    value's type under the type's kind (previously a `ZodObject<...>` husk
    with zero members). JSDoc reads the type declaration first and falls back
    to the const's docs; `@nodocs` on either declaration suppresses;
    `sourceLine` points at the type declaration.
  - `TypeDeclarationJson`/`InterfaceDeclarationJson` gain `mergedValue`
    (default `false`, stripped on the wire): the exported name is also
    importable as a runtime value.
  - `generateImport` emits a plain `import` for merged declarations instead of
    `import type`, which broke value use (`Foo.parse(...)`) when copy-pasted.

- feat: registry-recovered reference nodes carry `module` ([#28](https://github.com/fuzdev/svelte-docinfo/pull/28))

  `{kind: 'reference'}` nodes the alias registry recovers gain `module` — the
  winning alias's declaring `ModuleJson.path` — for collision-exact linking;
  only emitted modules register, so a `(module, name)` lookup can't dangle.
  Registry-only: written-channel recoveries and checker-named references stay
  module-less, so consumers handle absence. `TypeJsonToken` `name` tokens pass
  it through. Additive and wire-compatible.

- feat: `mergeReExports` and `resolveComponentAliases` return new arrays ([#21](https://github.com/fuzdev/svelte-docinfo/pull/21))

  Breaking: the postprocess passes no longer mutate their input
  `modules` — use the return value:

  ```ts
  const processed = resolveComponentAliases(mergeReExports(modules));
  ```

  Unchanged modules and declarations flow through reference-equal (structural
  sharing), so idempotent re-runs return the same objects.

- fix: emit component props in source order ([#15](https://github.com/fuzdev/svelte-docinfo/pull/15))

  Props were emitted in the checker's property order, which visibly
  interleaves the authored declaration order and is unrecoverable
  client-side. `props` now follows declaration position: same-file properties
  by source offset, cross-file groups by file path, declarationless symbols
  last by name. One pick rule decides which declaration represents a prop —
  the symbol's declaration in the component's own file when one exists — and
  the sort key, the prop's JSDoc, the written annotation feeding `typeInfo`
  name recovery, and diagnostic position mapping all read it — so a prop
  redeclared over an external bag (`HTMLAttributes<HTMLElement> &
{onclick?: () => void; …}`) keeps its authored position and the JSDoc
  written on the redeclared name. Cross-file grouping for genuinely-inherited props is by path, not "the
  component's own file first" — a prop inherited from a project-local base
  interface lands before or after the local ones depending on how the two
  paths compare.

- feat: expose `getProgram()` on `AnalysisSession` ([#15](https://github.com/fuzdev/svelte-docinfo/pull/15))

  Incremental consumers doing their own checker work over analyzed
  declarations (e.g., a docgen provider converting `ts.Type`s into its own
  structured model) can now reach the LS-backed `ts.Program` directly instead
  of building a second program. Freshness caveat documented on the method: it
  returns whatever the most recent ingest produced — reference-stable while no
  file version bumps, fresh (with unchanged ASTs reused) after one — so
  retained references go stale after any `setFile`/`setFiles`/`deleteFile`.

- feat: gate the module set through `isSource` at query time, and harden the source scope ([#17](https://github.com/fuzdev/svelte-docinfo/pull/17))

  Output previously trusted its input wholesale: any file handed to `analyze()`
  or a session became a `ModuleJson` — excluded test files, out-of-root files
  with absolute paths, even a root `tsconfig.json`. Now `session.query()`
  filters the emitted module set through `isSource`. Ingest stays ungated on
  purpose: non-source files still feed the checker as in-memory context;
  `session.list()` reports the full owned set and `query()` logs the gated
  count as info.

  Scope changes landing with the gate:

  - **Include patterns widen the source scope.** Each explicit `include`
    pattern's static base joins `sourcePaths`, so include-discovered files pass
    the gate, get module paths relative to the widened set's common root
    (`--include 'src/**'` now yields `lib/a.ts`, not `a.ts`), and get
    dependency edges. The Vite plugin widens identically, which also fixes its
    watcher for those files. A pattern with no base (`'**/*.ts'`, a literal
    root file) scopes the whole project root and logs an info line naming it.
    Absolute include patterns follow the same rule as absolute path entries:
    inside the root they relativize (previously the base scan
    leading-slash-stripped them into silent dead config), outside it they
    throw with the drop-the-slash hint.
  - **Always-on baseline exclusions.** `node_modules` and dot-directories below
    a source path are never source — applied by `isSource` (gate, watcher,
    dependency edges) and as anchored glob ignores at discovery. Matched
    relative to the matched source path, so an explicit dot-dir source path
    (`['.hidden/src']`) still works; `dist`/`build`/`coverage` stay in.
    Independent of `exclude`, which replaces defaults wholesale.
  - **Out-of-root config throws.** A `sourcePaths` entry, `sourceRoot`, or
    widened include base resolving outside `projectRoot` now throws at options
    creation instead of silently emitting nothing. Absolute entries are
    accepted when they resolve inside `projectRoot` (stored root-relative);
    a root-anchored `'/src/lib'` is no longer shorthand for `'src/lib'` — the
    error hints to drop the slash. In-root `.`/`..` segments normalize away
    (`src/../lib` → `lib`, `.` → `''`).
  - **Exclude and glob fixes.** Concrete package.json export entries now
    respect `exclude` at discovery (previously only wildcards did), and
    `deriveIncludePatterns` derives a relative root glob for the `''` source
    path — the old `/**` shape globbed from the filesystem root. Absolute
    exclude globs normalize like the other absolute inputs — in-root
    relativizes, out-of-root throws — closing a stage disagreement where the
    glob `ignore` honored an absolute exclude at discovery while `isSource`
    and the concrete-export check matched root-relative paths and silently
    never excluded (so `analyze()`/session consumers leaked the file into
    output).

- fix: extract props and docs from JS (no `lang="ts"`) components ([#12](https://github.com/fuzdev/svelte-docinfo/pull/12))

  Previously JS components yielded `props: []` silently and lost their HTML
  `@component` comment.

  - props extract from the JSDoc `@type` on `$props()` — typedef references,
    `import('...')` types, optionality, `@property` descriptions, defaults,
    `$bindable`, snippet-typed props; untyped destructuring extracts from the
    typedef svelte2tsx synthesizes
  - the HTML `@component` comment lands as `docComment` again — tags-only
    `@type`/`@typedef` blocks no longer claim the doc slot
  - `@property` descriptions on typedef-declared symbols now flow through
    `parseComment` for all extractors, not just component props
  - a checker throw while resolving the `$props()` type now emits the
    `svelte_prop_failed` diagnostic it always claimed to (previously swallowed)

  Breaking API changes: `SvelteVirtualFile` replaces `lang` with `scriptKind`
  (analysis output unchanged); `virtualFiles` values and
  `AnalysisLanguageService.setFile(path, entry)` take `VirtualFileEntry`
  (`{content, scriptKind?}`).

  Caveats: a description block above a separate `/** @type {...} */` block
  never attaches in the AST — use the HTML `@component` comment, or write the
  description inside a typedef-referencing `@type` block. Legacy `export let`
  components still extract zero props.

- feat: parse the tsconfig once per session; add `getCompilerOptions()` to `AnalysisLanguageService` ([#20](https://github.com/fuzdev/svelte-docinfo/pull/20))

  The session's lazy default `ImportResolver` re-invoked `loadTsconfig`, so a
  cold run with the default resolver parsed the tsconfig twice — duplicating
  the `include` glob's directory walk and doubling the "using
  .../tsconfig.json" log line. It now reuses the merged options the
  `LanguageService` parsed at construction, exposed on the handle as
  `getCompilerOptions()` (cheap — no LS sync, unlike
  `getProgram().getCompilerOptions()`). The tsconfig is a construction-time
  snapshot for the resolver too: after a tsconfig.json edit, create a new
  session.

- feat: `typeJsonToTokens` renders `TypeJson` trees; remove `findTypeReferences`/`buildTypeReferencePatterns` ([#27](https://github.com/fuzdev/svelte-docinfo/pull/27))

  - New `typeJsonToTokens(node)` (+ `TypeJsonToken`) flattens a
    `typeInfo`/`returnTypeInfo` tree into a render-ready token list — `name`
    tokens for linkable references (alias-carrying unions/intersections
    included), `code` tokens for terminal type text, `text` tokens for
    structural punctuation. The tokenizer owns spacing, separators,
    parenthesization, and tuple labels; what a token looks like stays the
    renderer's decision. `typeJsonToText(node)` is the concatenated plain-text
    form.
  - **Breaking**: `findTypeReferences`/`buildTypeReferencePatterns` are removed
    (regex name-matching over flat type strings; unused ecosystem-wide).
    Migrate by rendering `typeInfo` via `typeJsonToTokens`, falling back to
    the flat string where the tree is absent.

- feat: structured type extraction — `TypeJson` via `typeInfo`/`returnTypeInfo` ([#15](https://github.com/fuzdev/svelte-docinfo/pull/15))

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
  (class fields stay `kind: 'variable'`), and a generic callable property
  carries `genericParams`. `@default` on a callable-classified member lands as
  `defaultValue` — function members carry the field (see the function-member
  `defaultValue` changeset in this release).

  Breaking: `isSnippetTypeString(typeString)` is replaced by the structural
  `isSnippetType(type, checker)`; an alias over a `Snippet` instantiation now
  matches, so aliased snippet props gain `parameters`. Snippet `parameters`
  take tuple labels from parameter-derived elements and report rest elements
  faithfully (`rest: true` with the printed array form);
  `synthesizeSnippetTypeSignature` renders the `...` marker.

- chore: move `typescript` to peer dependencies ([#15](https://github.com/fuzdev/svelte-docinfo/pull/15))

  Breaking for consumers without `typescript` installed (npm 7+ auto-installs
  peers, so most setups need no change). Same `^5.9.3` range, now matching how
  `svelte`, `svelte2tsx`, and `zod` are handled — consumers with their own TS
  (build tools, editor tooling) no longer carry a second instance in the tree.

### Patch Changes

- fix: optional class methods keep their signatures under `strictNullChecks` ([#38](https://github.com/fuzdev/svelte-docinfo/pull/38))

  `m?(): void {}` resolves to `(() => void) | undefined`, which reports no
  call signatures — the member shipped as `kind: 'function'` with no
  `typeSignature`/`parameters`/`returnType`, and without `optional: true`.
  The class-method site now strips the widening before querying signatures,
  like the interface-method site, and optional methods carry `optional: true`.

- fix: `Diagnostic.file` honors its project-root-relative contract; the Vite plugin stops publishing absolute paths ([dcac27b](https://github.com/fuzdev/svelte-docinfo/commit/dcac27b))

  - **Six kinds were relative to `sourceRoot`, not the project root** —
    `duplicate_declaration`, `module_skipped`, `legacy_props`,
    `duplicate_comment`, `svelte_prop_failed`, and `misplaced_tag` from a Svelte
    module comment. `sourceRoot` defaults to `src/lib`, so this was the default
    behavior rather than an edge case: one analysis reported the same file as
    both `Widget.svelte` and `src/lib/Widget.svelte`, grouping by `file` gave two
    buckets for one file, and `formatDiagnostic`'s `./${file}` didn't resolve
    from the project root. Producers now emit the absolute id and let
    `normalizeDiagnosticPaths` rewrite it — the path every extractor diagnostic
    already took — and the `module_skipped` messages that name a file now name
    the same string `file` does.
  - **The Vite plugin published absolute paths** — it never normalized its
    _discovery_ diagnostics, so a `module_unreadable` message, which wraps the fs
    error and therefore embeds the developer's absolute path, reached
    `virtual:svelte-docinfo` verbatim and shipped to any bundle importing it.
    `analyzeFromFiles` already normalized it before merging and the plugin now
    does the same; consumers calling `discoverSourceFiles` /
    `discoverFromExports` directly still own that call, now stated on the
    `Diagnostic.file` schema doc.

  `Diagnostic.file` names a file, never a module — `ModuleJson.path` is
  `sourceRoot`-relative, and `DuplicateDeclarationDiagnostic.modules` still holds
  those values, so `file` and `modules` read differently for the same module. A
  consumer matching `Diagnostic.file` against `ModuleJson.path`, which those six
  kinds accidentally allowed, needs to prefix `sourceRoot` (or read
  `duplicate_declaration`'s `modules`, unchanged). Direct `analyzeModule` /
  `analyzeSvelteModule` callers still see the absolute form until they run
  `finalizeDiagnostics`, as every other diagnostic already reached them.

- fix: members typed by external functions stop harvesting the external overload set ([#39](https://github.com/fuzdev/svelte-docinfo/pull/39))

  A property typed by an external function — `run?: typeof spawn` from
  `node:child_process` — classified `kind: 'function'` and enumerated the
  package's whole overload set: 20 overloads carrying Node's full
  documentation (~27KB from one member), plus `misplaced_tag` /
  `unknown_param` warnings pointed at `node_modules` files the user can't act
  on. External-origin call signatures now filter before classification — the
  membership rule at signature granularity — so a wholly-external callable
  documents as the flat type text under `kind: 'variable'`, a mixed callable
  keeps its local signatures, and local callables are unchanged.

- fix: normalize the absolute module paths TypeScript embeds in printed type text ([#25](https://github.com/fuzdev/svelte-docinfo/pull/25))

  The checker prints a module object as `typeof import("<absolute path>")` — from
  an `import()` expression or a `typeof` over a namespace import. It reached
  `typeSignature` (declarations and members), `returnType`, and the `text`/`name`
  of a `TypeJson` node, exposing the svelte2tsx virtual suffix on Svelte targets.
  Output was machine-dependent as a result, and any site rendering
  `typeSignature` published a local filesystem path.

  Paths now normalize in tiers: a module in this output is named by its
  `ModuleJson.path`, so the string doubles as a lookup key — linkify with
  `modules.find((m) => m.path === s)` and read a miss as "not a module here"
  (`typeof import("Wid.svelte")` for a component). A package is named by its path
  below `node_modules/`, and everything else relative to the project root —
  root-relative for an in-project file that emits no module, `../sibling/x.ts`
  for one outside it.

  Only paths naming a file the program loaded are rewritten, leaving author text
  and path-shaped string-literal types (`type P = "/usr/bin"`) untouched.

  Diagnostics get the same treatment. `Diagnostic.message` is now scrubbed
  alongside `Diagnostic.file`, so no field on the record carries an absolute path
  — `import_parse_failed` previously leaked one through the wrapped
  es-module-lexer error. And a `Diagnostic.file` outside the project root now
  takes the `../` form rather than having its leading slash dropped, which had
  produced a string that reads as root-relative but resolves elsewhere; rejoining
  with `projectRoot`, as the docs have always said to, now recovers the original
  path in every case.

- fix: make script-tag scanning quote-aware and attribute-accurate ([#14](https://github.com/fuzdev/svelte-docinfo/pull/14))

  The original-source script scan (module comments, legacy-prop detection,
  `extractScriptContent`/`extractModuleScriptContent`) now ports Svelte's own
  preprocessor regex and decides by parsed attributes instead of
  pattern-matching raw tag text:

  - attribute values containing `>` (`generics="T extends () => void"`) no
    longer truncate the opening tag and mangle the extracted content
  - module scripts are identified by attribute name (`module`, or
    `context="module"`), so the word `module` inside an attribute value no
    longer misclassifies the instance script or shadows a real
    `<script module>`
  - commented-out scripts (`<!-- <script>… -->`) are skipped
  - `</script >` is matched (Svelte's parser accepts it); self-closing
    `<script />` and capitalized `<Script>` component tags are not
  - `lang` is read from script-tag attributes, not a whole-file text search, so
    `lang="ts"` appearing in markup no longer flips a JS component to TS parsing
    and silently discards its JSDoc prop types
  - `lang` detection matches the Svelte compiler: the first script tag with a
    valued `lang` decides the file, and only `lang="ts"` counts —
    `lang="typescript"` is now treated as JS

- fix: correct optional type signatures ([#11](https://github.com/fuzdev/svelte-docinfo/pull/11))

  - `a?: string | null` reported `"string"`
  - `a?: null` reported `"never"`, and so did `a?: undefined`
  - `b?: number` reported `"number | undefined"` as a parameter type
  - `fn?(a: string): number` shipped with no `typeSignature`, `parameters`, or
    `returnType` under `strictNullChecks`, and `fn?: () => void` and
    `fn?: (() => void) | (() => number)` were demoted from `kind: "function"`
    to `"variable"`
  - component props typed `Snippet<[...]> | null` without `?` lost their
    snippet `parameters`
  - optional snippet tuple elements (`Snippet<[a?: string]>`) reported
    `"string | undefined"` alongside `optional: true`, and synthesized snippet
    `typeSignature`s omitted the `?` marker (`Snippet<[a: string]>` for a
    snippet declared `{#snippet greet(a?: string)}`)

  A callable's `typeSignature` still renders the checker's widening
  (`"(b?: number | undefined): void"`) — it comes from `signatureToString`, which
  has no flag to omit it.

- fix: remap Svelte `<script module>` diagnostic positions to the original source ([#30](https://github.com/fuzdev/svelte-docinfo/pull/30))

  Diagnostics emitted from a svelte2tsx virtual (`misplaced_tag`,
  `unknown_param`, `alias_lost`, `type_extraction_failed`,
  `signature_analysis_failed`, `class_member_failed`) had their `file`
  normalized to the `.svelte` path while keeping the virtual's line/column —
  wrong whenever markup or an instance script shifts the `<script module>`
  content. Positions now remap through the source map to the original `.svelte`
  source, and an unmappable position (no source map, or a node svelte2tsx
  synthesized) drops `line`/`column` instead of publishing a virtual line.

  Callers assembling modules themselves through `analyzeModule` /
  `analyzeSvelteModule` get the new `finalizeDiagnostics(diagnostics,
{projectRoot, virtualFiles})`, which runs the position remap and
  `normalizeDiagnosticPaths` in their required order (remap first — path
  normalization strips the virtual suffix the remap matches `file` against).

- fix: `svelte_prop_failed` drops unmappable positions instead of publishing a virtual line ([#31](https://github.com/fuzdev/svelte-docinfo/pull/31))

  The per-prop diagnostic names the original `.svelte` file but took its
  position from the helper that populates declaration `sourceLine`, which falls
  back to the svelte2tsx virtual's own coordinates when the source map can't
  resolve a node — so a prop declaration svelte2tsx synthesized would ship a
  generated-TS line under a `.svelte` path. It now leaves `line`/`column`
  absent, matching the rule the `<script module>` diagnostics already follow.
  Mappable positions are unchanged, as is declaration `sourceLine`, which keeps
  its fallback deliberately. The branch is latent today — every prop
  declaration the extraction anchor reaches maps cleanly — so no output moves.

- fix: written-name recovery stops at the exported name instead of the declaration's ([#33](https://github.com/fuzdev/svelte-docinfo/pull/33))

  Written-name recovery resolved a type reference through its whole alias chain,
  down to the declaration. A module that renames on the way out breaks that:
  with `hop.ts` doing `export type {Inferred as Public}`, an annotation of
  `Public` recovered `{kind: 'reference', name: 'Inferred'}` — a name `hop.ts`
  does not export. Written-channel references carry no `module`, so the name is
  the whole of what a consumer has to go on.

  Recovery now stops at the nearest specifier's published name. `Public` stays
  `Public`, a rename of it (`import type {Public as R}`) resolves one hop to
  `Public` rather than the local `R`, and a namespace-qualified `ns.Public` —
  which reaches the re-export directly rather than through an import binding —
  lands on `Public` as well. Only an alias naming no export, a default or
  namespace import, still falls through to the chain, where the declaration's
  own name is the only name there is. Unrenamed imports, references the checker
  already names, registry-recovered names, and every flat `typeSignature` /
  `returnType` are untouched.

  This is the rule `externalTypes` entries already follow for their import
  renames, now one shared primitive behind both channels.

## 0.5.5

### Patch Changes

- fix: docComment detection should ignore module script ([#9](https://github.com/fuzdev/svelte-docinfo/pull/9))

## 0.5.4

### Patch Changes

- fix: non-root module detection with Node-resolving rules for glob exports ([4570f3e](https://github.com/fuzdev/svelte-docinfo/commit/4570f3e))
- add `to_error_message` and `error.ts` ([d145381](https://github.com/fuzdev/svelte-docinfo/commit/d145381)) ([refactor](https://github.com/fuzdev/svelte-docinfo/commit/refactor))

## 0.5.3

### Patch Changes

- fix: `docComment` and `moduleComment` collision ([40bcb7c](https://github.com/fuzdev/svelte-docinfo/commit/40bcb7c))

## 0.5.2

### Patch Changes

- fix: `.svelte` resolution and dedupe `ModuleJson.dependencies` ([c48e203](https://github.com/fuzdev/svelte-docinfo/commit/c48e203))

## 0.5.1

### Patch Changes

- fix: remove errant `@nodocs` on `index.ts` module comment ([3a96842](https://github.com/fuzdev/svelte-docinfo/commit/3a96842))
- fix: improve `@nodocs` handling to warn on module comments ([3a96842](https://github.com/fuzdev/svelte-docinfo/commit/3a96842))

## 0.5.0

### Minor Changes

- feat: publish re-exports from the re-exporting module's side — ([#3](https://github.com/fuzdev/svelte-docinfo/pull/3))
  `ModuleJson.reExports` (`ReExportJson` — `{name, module, typeOnly, sourceLine}`,
  the forward view of `alsoExportedFrom`), plus `ModuleJson.externalReExports`
  (`ExternalReExportJson`) and `externalStarExports` for statements directly
  referencing an external package. Import-then-export and chains through a source
  module stay silent.

  feat: add `resolveExportSurface(modules, path)` — combines declarations,
  re-export edges, externals, and transitively-resolved stars into one name-sorted
  surface with provenance, applying ES star semantics (explicit beats star, names
  ambiguous between stars excluded, `default` never projects) and reporting
  `unresolvedStarExports`/`externalStarExports` instead of guessing.

  feat: synthesized alias declarations now carry `sourceLine` pointing at the
  local export specifier (previously `undefined`); Svelte `<script module>` lines
  are remapped to the original source.

  Breaking:
  - `mergeReExports(modules, collectedReExports)` → `mergeReExports(modules)`;
    `analyzeModule` returns `ModuleJson` directly (`ModuleAnalyzeResult` removed);
    removed `ReExportEntry`/`ReExportInfo` types (`ModuleExportsAnalysis.reExports`
    entries rename `originalModule` → `module`, now `ReExportJson`)
  - star projection is no longer materialized in the projecting module — value
    symbols, projected specifiers, and namespace bindings alike produce no
    declarations, edges, or back-links; `starExports` is the sole encoding (this
    also removes the spurious `duplicate_declaration` diagnostics star exports
    used to produce)
  - `findDuplicates` compares by canonical identity (resolving `aliasOf` chains),
    so an alias and its canonical no longer flag — fixes false positives on
    documented same-name re-exports and `export {default as Foo} from './Foo.svelte'`
  - statement-level `@nodocs` now suppresses `starExports` entries, consistent
    with the other re-export encodings

## 0.4.1

### Patch Changes

- feat: add `AnalyzeResultJsonWire` for the vite plugin value ([#2](https://github.com/fuzdev/svelte-docinfo/pull/2))

## 0.4.0

### Minor Changes

- chore: fix peer deps ([0e39268](https://github.com/fuzdev/svelte-docinfo/commit/0e39268))

## 0.3.0

### Minor Changes

- fix: improve inferred type output for intersections and unions ([#1](https://github.com/fuzdev/svelte-docinfo/pull/1))

## 0.2.1

### Patch Changes

- fix: use `Object.create(null)` to avoid prototype issues ([7b79be8](https://github.com/fuzdev/svelte-docinfo/commit/7b79be8))

## 0.2.0

### Minor Changes

- feat: capture object-property `@param obj.prop` descriptions ([d52b3d3](https://github.com/fuzdev/svelte-docinfo/commit/d52b3d3))

### Patch Changes

- fix: ignore node builtins ([6848647](https://github.com/fuzdev/svelte-docinfo/commit/6848647))
- fix: accept dotted `@param obj.prop` keys in param validation ([6848647](https://github.com/fuzdev/svelte-docinfo/commit/6848647))

  `@param obj.prop` (documenting a property of an object/destructured parameter)
  no longer emits a spurious `unknown_param` warning when `obj` is a real
  parameter.

- fix: resolve without vite to avoid polluting its detection ([b82e4e4](https://github.com/fuzdev/svelte-docinfo/commit/b82e4e4))

## 0.1.0

### Minor Changes

- init ([7ededbf](https://github.com/fuzdev/svelte-docinfo/commit/7ededbf))
