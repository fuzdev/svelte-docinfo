# svelte-docinfo

> static analysis for TypeScript and Svelte

Extracts structured metadata from TypeScript and Svelte 5 source via the TypeScript
compiler API — full type inference instead of manual annotations. Build-tool agnostic;
consumers add package metadata and formatting. Use cases: docs, code search, dev tools.

Conventions: [fuz-stack skill](https://github.com/fuzdev/fuz_docs), with one deliberate
divergence: the API is **camelCase**, since the package serves the broad Svelte ecosystem.
For the same reason `@fuzdev/fuz_util` is dev-only: `src/lib` never imports it, hence the
local `toErrorMessage` and `mapConcurrent`.

**This file is the map.** Behavioral policy lives in TSDoc beside the code. Each section
points to the TSDoc that owns its policy; read it before changing behavior. User-facing docs are the tomes in
`src/routes/docs/`. Examples: `examples/vite/`, `examples/api/`, `examples/cli/`.

## Capabilities

- **Type resolution** — imported types, generics, inferred types. Every member type is
  checker-backed.
- **Structured types** — optional `typeInfo` (`TypeJson`, a recursive 10-kind valibot schema)
  beside the flat type strings: component props, parameters (snippet tuple elements
  included), `returnTypeInfo` (functions, methods, overloads), type-alias/interface/class
  members, variable and type-alias declarations. Policy lives on the `TypeJson` schema
  TSDoc (`types.ts`) and in `typescript-extract-type-json.ts`:
  - **Absence contract** — absent when the flat string is the whole story (intrinsics, bare
    references, object/function roots). Relaxed at type-alias roots, where the flat string
    is just the alias name, and at recovered roots.
  - **Shape** — union/intersection members keep alias names (read off the union's internal
    `origin`, with a validated fallback). Union members take the written order: the alias
    declaration's right-hand side for a non-generic aliased union, else the site annotation,
    validated and falling back to the checker's order; nullish members sink last.
    `true | false` collapses to `boolean`; the optional-widening `undefined` is dropped.
    A literal `value` JSON can't carry (a bigint, a non-finite number) is a string.
    Named generic instantiations (`Snippet<[a: string]>`) are `reference` nodes with
    `typeArgs`; every other callable is `function`. Object literals and functions stay
    terminal `text` (1000-char budget). Depth is capped at 5, degrading to `{kind: 'other'}`.
  - **Name recovery** — TypeScript drops the alias of a type over an indexed access or
    conditional (`z.infer<typeof S>`), expanding it at every use. A svelte2tsx-generated
    alias (declared in a virtual or the shims) counts as none (`linkableAliasSymbol`), so
    `ComponentProps<typeof X>` over inline props is lost the same way, never
    `$$ComponentProps`. Two channels recover
    `{kind: 'reference', name}`. The **written** channel resolves the annotation at the
    site, through import aliases to the exported name (`specifierExportedName`). The
    **registry** channel (`buildAliasRegistry`, a query-scoped pre-pass) matches by type
    identity against exported, non-`@nodocs`, non-generic lost aliases of emitted modules,
    so unannotated inferred positions recover too. Registry hits carry `module` (always an
    emitted module), and ambiguity resolves to a single global winner. The policy: never
    name what the project didn't declare. Losses nothing recovers emit `alias_lost`.
- **Member projection** — type-alias and interface properties share `populatePropertyMember`:
  a callable becomes `kind: 'function'` with signature fields, anything else gets
  `typeSignature` + `typeInfo`. External-origin call signatures are filtered first, so
  `run?: typeof spawn` stays a `variable`. Class fields stay `variable` even when
  function-typed. Interfaces enumerate own members only. Literal member names are unquoted
  (`memberNameText`) and computed names are skipped.
- **TSDoc/JSDoc** (`tsdoc.ts`)
  - Tags: `@param`, `@returns`, `@throws`, `@example`, `@deprecated`, `@internal`, `@see`,
    `@since`, `@default`, `@module`, `@nodocs`, `@mutates`. `@return` → `@returns` and
    `@defaultValue`/`@defaultvalue` → `@default`.
  - `@internal` is a marker, not an exclusion: it sets `internalMessage` and the declaration,
    member, or component prop stays documented. `@nodocs` removes the declaration from docs
    and duplicate checking. It applies to declarations and export statements only; in a module
    comment it has no effect and warns `misplaced_tag`.
  - `@mutates` splits target from description at ` - `. On a component prop it declares what
    the component writes into the value it's handed. Dotted `@param obj.prop` tags fill
    `ParameterJson.propertyDescriptions`.
  - `@default` → `defaultValue` lands on variables, component props, and function/variable
    members, never on top-level functions, overloads, or constructors.
  - Text is kept raw: inline `{@link}` survives, and rendering is the consumer's concern.
- **Overloads** — every public signature with its own JSDoc. Signature-scope tags
  (`@param`/`@returns`) flow to their overload. The first signature is primary: its JSDoc
  documents the symbol, and symbol-scope tags on any later overload emit `misplaced_tag`.
- **Merged value+type symbols** — `const Foo = z.strictObject(...)` +
  `type Foo = z.infer<typeof Foo>` documents the type meaning (`selectDeclarationNode`).
  `mergedValue: true` records that the name is also a runtime value, so `generateImport`
  emits a value import. JSDoc falls back to the const when the type has none. Class+interface
  merges document the class.
- **Svelte 5 components** — props, generics, snippets, and `acceptsChildren` via svelte2tsx +
  the checker. JS components (no `lang="ts"`) take props from the JSDoc `@type` on
  `$props()`, or from the typedef svelte2tsx synthesizes for untyped destructuring. Legacy
  `export let` components document their props the same way (see Svelte Component Analysis).
- **Runes** — `$state`, `$state.raw`, `$derived`, `$derived.by` are detected syntactically in
  every file (`reactivity`).
- **Re-exports and diagnostics** — see Key Design Decisions. Dependency edges: Sources and
  Scope. Source lines: the `sourceLine` contract under Data Model.

## Architecture

### Modules

**Low-level** (compiler API)

- `typescript-program.ts`
  - Entry points: `createAnalysisProgram` (one-shot `ts.Program`),
    `createAnalysisLanguageService` (persistent LS: `setFile`/`deleteFile`/`getProgram`/…),
    and `loadTsconfig`.
  - `loadTsconfig` parses relative to the config file's own directory (as `tsc -p` does),
    and throws when the config or anything in its `extends` chain fails to load (SvelteKit's
    generated tsconfig before `svelte-kit sync`), rather than analyzing with inherited
    options silently dropped; option-level diagnostics and TS18003 don't throw.
  - `tsconfig: false` analyzes without a config file, on `DEFAULT_COMPILER_OPTIONS` (strict,
    since the compiler's own defaults are non-strict before TypeScript 6). It's explicit,
    never a fallback: a config that can't be found still throws.
  - `rootFileNames` (`RootFileNames`: a list, or a function over the tsconfig's roots)
    replaces the program's roots, which otherwise make cold cost scale with the project.
    Narrowing changes output only for ambient types declared in a file nothing imports,
    which then resolve to `any` with no diagnostic; `declarationFileRoots` is the preset
    that keeps the `.d.ts` roots. The `RootFileNames` TSDoc owns the
    policy. Every entry point forwards `tsconfig`, `compilerOptions`, and `rootFileNames`
    (the CLI as `--tsconfig`/`--no-tsconfig` only).
  - `createIsExternalFile`/`createIsExternalPath` decide externality: outside the root,
    under `node_modules`, or a `.d.ts` outside the source root. That's a different axis from `isSource`
    — a gated local file isn't external.
  - Virtual files are `VirtualFileEntry` (`{content, scriptKind?}`); the `scriptKind`
    override makes JS-lang Svelte virtuals parse as JS.
  - Both hosts answer `directoryExists` from served files (`createOwnedDirIndex`), so an
    in-memory file in a directory absent from disk still resolves.
  - A program with Svelte virtuals also roots svelte2tsx's `svelte-shims-v4.d.ts`
    (`getSvelteShimRoots`), resolved from svelte-docinfo's own svelte2tsx. Without it every
    component's type is `any`; TS-only programs root nothing extra. Flat strings print
    component types as the checker sees them, svelte2tsx's generated names included
    (`Component<$$ComponentProps, {}, "">`); the `TypeJson` builder treats generated aliases
    (`$$ComponentProps`, the shims' `__sveltets_2_PropsWithChildren`) as nameless
    (`linkableAliasSymbol`), and identifies the shims by path (`isSvelteShimPath`).
- `typescript-extract-*.ts` — per-kind extractors, `@internal`, imported directly (no barrel):
  - `-shared.ts`
    - `ExtractContext`, built by `createExtractContext`: pass-constant state only —
      checker, diagnostics, `isExternalFile`, `aliasRegistry`,
      `exactOptionalPropertyTypes`.
    - Declaration kind inference and selection.
    - Signature/property projection (`populateCallableMember`, `populatePropertyMember`).
    - The optional-widening gate (`optionalWidened`).
    - External filtering and `externalTypes` attribution (`filterDocumentedProperties`,
      `applyHeritageExternalTypes`).
    - Class visibility (`isPrivateMemberDeclaration`) and rune detection.
  - `-function.ts`, `-type.ts` (aliases, interfaces, enums), `-class.ts`, and
    `-type-properties.ts` (alias property enumeration, `hasExtractableProperties`).
  - `-type-json.ts` — `resolveTypeInfo` (the `TypeJson` builder), the registry types and
    predicates, and policy primitives shared with the flat-string paths
    (`optionalWideningTarget`, `referenceSymbolName`, the tuple helpers), so strings and
    trees can't drift.
- `typescript-alias-registry.ts` — `buildAliasRegistry(sources, checker)`. `analyzeCore`
  runs it; direct `analyzeModule`/`analyzeSvelteModule` callers run it themselves or get
  written-channel recovery only.
- `typescript-exports.ts` — module orchestration: `analyzeTypescriptModule`,
  `analyzeExports`, `analyzeDeclaration`, `extractModuleComment`. Handles alias chains,
  namespace classification, re-export JSDoc routing, merged symbols, and `alias_lost`.
- `tsdoc.ts` — `parseComment`, `applyToDeclaration`, `cleanComment`, `hasDocContent`.
- `diagnostics.ts` — `Diagnostic` (a discriminated union on `kind`), `DiagnosticKind`,
  `DiagnosticSeverity`, `parseDiagnostics`, and read helpers (`hasErrors`, `errorsOf`,
  `byKind`, `formatDiagnostic`, …). Diagnostics are a plain `Array<Diagnostic>`.
- `log.ts` — `AnalysisLog` (`info`/`warn`/`error`): unstructured progress, separate from
  diagnostics.

**Mid-level**

- `svelte.ts`
  - `analyzeSvelteModule`, `transformSvelteSource`.
  - Script and module-comment extraction, always from the *original* source, never the
    virtual. The component's script tags are located once, at transform, and ride the
    virtual (`SvelteVirtualFile.scriptTags`).
  - Snippet helpers.
- `svelte-scripts.ts` — `@internal`, imported directly (not in the barrel):
  `findScriptTags`, which locates a component's top-level `<script>` tags (see Svelte
  Component Analysis), `scanScriptTags`, and `isModuleScript`.
- `svelte-legacy.ts` — `@internal`, imported directly (not in the barrel): the legacy
  `export let` scan (`scanLegacyExports`) and props anchor (`resolveLegacyPropsAnchor`).
- `source.ts` — `SourceFileInfo`, file-type predicates, virtual-path helpers
  (`stripVirtualSuffix`, `SVELTE_VIRTUAL_SUFFIX`), the svelte2tsx generated-name filter
  (`isSvelte2tsxGeneratedExport`), and `getDefaultAnalyzer`.
- `paths.ts` — `toPosixPath`, `isAbsolutePosixPath`. Every stored, compared, or keyed path
  is POSIX; native paths are accepted at public boundaries.
- `dep-resolver.ts`
  - `ImportResolver` (`{resolve, identity, invalidate?}`) and `ResolveImport`.
  - `createDefaultResolver`: TS resolution plus a manual `.svelte` fallback.
  - `lexImports` (a syntax-only TypeScript parse) and `noDepsResolver`.
- `concurrency.ts` — `MAX_FILE_CONCURRENCY`, `MAX_RESOLVE_CONCURRENCY`, `mapConcurrent`.
- `error.ts` — `toErrorMessage`.
- `schema.ts` — helpers the schema modules share, a leaf importing only valibot:
  `parseWithSummary`, which the `parse*` helpers throw through so the message lists every
  reported issue, one `path: message` line each, and the `@nodocs` `Named` alias the schema
  interfaces extend through. Not in the barrel.
- `source-config.ts`
  - Options: `ModuleSourceOptions`, `createSourceOptions`/`normalizeSourceOptions`,
    `ExcludeOption`.
  - Source gating and paths: `isSource`, `extractPath`, `extractDependencies`.
  - Include widening (`createSourceOptionsWithInclude`), pattern normalization, and the
    baseline exclusions.
- `types.ts` — the output schemas (valibot): `ModuleJson`, `DeclarationJson` (9 variants),
  `MemberJson` (3), `TypeJson` (10 kinds), `OverloadJson`, and friends, plus
  `parseModuleJson`. Field-level policy lives here. Each exported object schema is typed
  through a `@nodocs` `FooSchema` interface (`extends Named<typeof FooImpl>`), which keeps
  the emitted declarations referential and small. A fully inlined `ModuleJson` sends
  consumers past TypeScript's instantiation depth (TS2589); a name on that root is enough
  to clear it, and the rest are there for size. `diagnostics.ts` and `AnalyzeResultJson` follow
  suit. `dist-types.test.ts` holds the emitted declarations to that: referential schema
  consts, a size budget, and a consumer that typechecks against them.
- `declaration-build.ts` — permissive build-time types (`DeclarationJsonBuild`,
  `MemberJsonBuild`, …): every field optional except `kind`. The schemas validate at the
  `parseModuleJson` boundary.
- `declaration-helpers.ts`
  - Display and import generation: `getDisplayName`, `generateImport`.
  - `compactReplacer` and `isKind`.
  - `typeJsonToTokens`/`typeJsonToText`: the renderer contract. A corpus test tokenizes
    every tree in the fixture baselines.
- `postprocess.ts`
  - Pure phase-2 passes: `mergeReExports`, `resolveComponentAliases`, `findDuplicates`,
    `sortModules`, `computeDependents`.
  - `resolveExportSurface`.
  - `compareStrings`: the comparator for all output ordering. Never use bare
    `localeCompare` or a default `.sort()`.
  - Input order is sorted too: `query()` analyzes the owned set in `compareStrings` order
    of file ID, the language-service host returns owned program roots in that order, and
    `globFiles`/`discoverFromExports` return files in it, so output is a function of the
    file set, not the crawl or ingest order. Analysis order matters because TypeScript
    prints an origin-less union (`z.enum` members, literal unions) in type-creation order,
    which follows the order the checker first visits files; root order sets the merge
    order of `declare global`, module augmentations, and interface merging. Two limits
    remain, for flat strings and for trees at positions with no written union node: an
    edit to an unrelated file can still reorder such a union's members, since it can
    change which file first creates a member type, and checker work through
    `getProgram()` before the first `query()` on a fresh program can reorder them in that
    query's output.

**High-level**

- `analyze.ts` — one-shot `analyze` and `analyzeFromFiles`, each a single-use session.
- `session.ts` — `createAnalysisSession` (see Incremental Analysis).
- `analyze-core.ts`
  - `analyzeCore`: the two-phase loop.
  - `analyzeModule`, `finalizeDiagnostics`, `normalizeDiagnosticPaths`,
    `normalizeModulePathsInTypes`.
  - `OnDuplicates`: the opt-in flat-namespace check. Off by default, since most packages
    reuse names across modules; any mode emits `duplicate_declaration`.
  - The envelope schemas `AnalyzeResultJson` and `AnalyzeResultJsonWire`, and
    `parseAnalyzeResult`.
- `vite.ts` — default export `svelteDocinfo`, serving `virtual:svelte-docinfo`.
  - Hooks: `configResolved`, `buildStart`, `buildEnd` (disposes the session),
    `resolveId`/`load`, and `configureServer` (watch plus debounced re-analysis, gated on
    `isSource(file) || session.has(file)`).
  - Only the files discovery selected are inputs (`inputIds`). Any other file's edit is
    passed with the context role, and an `add` event re-runs discovery to decide whether
    the new file is an input (and re-roles owned files the selection moved), aiming at dev
    output that matches a cold build of the same tree.
  - Vite 6+, per-environment dev APIs only. Changed output reloads the page (no HMR
    boundary: the module is data). The plugin serves one dev server at a time, adopted at
    its client `buildStart`. The `vite.ts` module TSDoc owns the lifecycle and restart
    policy. `vite.dev.test.ts` drives real middleware-mode servers.
  - Types live in the root `virtual-svelte-docinfo.d.ts`; its header explains why it
    can't move to `src/lib/`.

**Filesystem helpers** — `discovery.ts` (`discoverSourceFiles`), `files.ts` (`loadFile`,
`globFiles`, `deriveIncludePatterns`), `exports.ts` (`parsePackageExports`,
`discoverFromExports`, `createBlockedSpecifierChecker`).

**CLI** — `cli.ts` (`runCli`, commander) and `main.ts` (shebang entry, `dist/main.js`).

**Other** — `logo.ts` (docs-site SVG data, not in the barrel).

**Barrel**: `svelte-docinfo` re-exports the common surface. `./*.js` and `./*.ts` subpaths
expose every module's full API.

### Two-Phase Analysis

`analyzeCore` runs, in order:

0. **Alias-registry pre-pass** — `buildAliasRegistry` over the emitted set, with Svelte
   modules read through their virtuals.
1. **Module analysis** — dispatch by file type (TS, Svelte, CSS, JSON) to collect
   declarations and re-export facts. Gated Svelte virtuals (`contextSvelteFiles`) are
   analyzed only when an emitted alias references them.
2. **Linking** — `mergeReExports`, `resolveComponentAliases`, `sortModules`,
   `findDuplicates` (only when `onDuplicates` is set), `normalizeModulePathsInTypes`, and
   `finalizeDiagnostics`.

The `postprocess.ts` passes are pure (new arrays, structural sharing).
`normalizeModulePathsInTypes` and `finalizeDiagnostics` then rewrite phase 2's own output in
place.

### Sources and Scope

- **Vocabulary** — *owned*: ingested by the session. *Source* (emitted): owned and passing
  `isSource`, and not a closure-ingested dependency (see Context closure); only
  these produce a `ModuleJson`. *Gated*: in-root but failing `isSource`
  (e.g. `internal/`), visible to the checker but never emitted. *Context*: files the
  session reads from disk itself: gated ones, plus source dependencies nobody supplied. *External*: a package, an out-of-root file, or a `.d.ts`
  outside the source root — a separate axis from gating.
- **`SourceFileInfo`** — `{id, content, dependencies?}`. Files come from anywhere: disk,
  memory, or a build pipeline.
- **Owned ⊇ emitted** — ingest accepts any file, and owned content is served to the checker
  before the disk fallback. But `query()` gates emission through `isSource` (under
  `sourcePaths`, not matching `exclude`). Non-source files shape type resolution without
  emitting a module; the gated count is logged as info.
- **Reverse edges** — `dependents` are computed by `computeDependents` from the emitted set's
  forward edges, never supplied by the caller.

**Discovery** (`analyzeFromFiles`, `discoverSourceFiles`; details in `discovery.ts`,
`exports.ts`, `source-config.ts`):

- **Modes** — `'auto'` (default: `package.json` exports, falling back to globs), `'exports'`
  (strict; throws when `exports` is missing or empty), `'glob'`. Passing `include` collapses
  `'auto'` to glob; combining it with `'exports'` throws.
- **Include widening** — each include pattern's static base joins `sourcePaths`
  (`createSourceOptionsWithInclude`, shared by `analyzeFromFiles` and the Vite plugin). A
  root-crossing pattern makes the whole project root source, and logs it.
- **`exclude`** — a single field, applied both at discovery and at `isSource` (the query
  gate and dependency edges). The default is
  `['**/*.test.ts', '**/*.spec.ts', '**/internal/**']`. An array replaces the defaults; a
  `(defaults) => patterns` callback extends them.
- **The `src/lib/internal/` convention** — internal modules ship for public modules to import
  but aren't documented. Packages typically pair them with an `"./internal/*": null` exports
  key. Exports discovery honors null-target keys with Node's best-match semantics
  (`createBlockedSpecifierChecker`).
- **Always-on scope guards** — deliberately outside the default `exclude`, since a user
  `exclude` replaces the defaults wholesale.
  - The **baseline**: `node_modules` and dot-directory segments below a source path are never
    source. It's matched relative to that source path, so an explicit dot-dir `sourcePaths`
    entry still works. `dist`/`build` are not excluded.
  - **Out-of-root validation**: `sourcePaths`/`sourceRoot` entries and absolute include or
    exclude patterns that resolve outside `projectRoot` throw. In-root absolute paths
    relativize. `'/src/lib'` is filesystem-absolute, not shorthand.

### Svelte Component Analysis

Svelte 5+ only, enforced at runtime: svelte2tsx output changed too much across versions to
support older ones. The workflow, from the svelte2tsx virtual through props, is in the
`analyzeSvelteModule` TSDoc. In short:

- **Virtuals** — each `.svelte` file becomes a `.__svelte2tsx__.ts` virtual that the checker
  sees; the raw `.svelte` is never pushed to the LS. `.svelte` imports map to virtuals via
  `resolveSvelteVirtualSpecifier`, shared by both program paths.
- **Script tags** — only a top-level `<script>` is the component's instance or module
  script, as in Svelte; one nested in an element, a block, or `<svelte:head>` is an
  ordinary element and is never read. `findScriptTags` (`svelte-scripts.ts`, whose TSDoc
  owns the policy) decides in two steps:
  - A regex scan finds every tag. A tag preceded by nothing but whitespace, complete HTML
    comments, and earlier such tags is top-level by construction (`provenTopLevel`), which
    settles the usual scripts-first component with no parse.
  - Otherwise Svelte's parser decides, on the source with script and style content
    blanked. svelte2tsx parses the same way but demotes only tags the parser reads as
    nested elements, so a tag spelled in an expression string or attribute value is still
    a script to it. If the parser throws, every matched tag is kept.
  - The result is computed at transform time and carried on the virtual, so a query
    doesn't repeat it. The script language (`scriptKind`), the legacy `export let` scan,
    and the in-script `@module` comments all read these tags.
- **`<script module>` exports** analyze through the virtual; svelte2tsx internals are
  filtered (`isSvelte2tsxGeneratedExport`), and positions are remapped to the original
  source.
- **Props** come from `extractPropsViaChecker`, anchored on the `$props()` declaration's
  type:
  - Local props are emitted in source order. `representativeDeclaration` picks the component-file
    declaration when a prop is redeclared over an external bag.
  - External-origin props are filtered (see `externalTypes`), except the names the
    `$props()` destructuring binds: those are admitted with the external type and JSDoc
    and follow the other props in destructuring order. The rest element, a name the type
    lacks, and an index-signature-only name admit nothing.
  - `defaultValue` is verbatim source text, keyed by prop name (`class: c = 'a'` → `class`).
- **Callback props** — a prop whose type has a call signature this project declared
  carries `returnType`/`returnTypeInfo` and, when it has any, `parameters`. `returnType`
  is the marker: snippets have `parameters` without it, and a zero-parameter callback
  has it without `parameters`. `null` and the optional `undefined` are stripped first; a
  union of functions is not a callback. External-origin signatures never count
  (`localCallSignature`, the callable-member rule), which keeps `Component`-typed props
  out and picks the own signature from `MouseEventHandler<…> & (() => void)`. The
  `returnType` field doc in `types.ts` is the full statement.
- **`acceptsChildren`** — true when a `Snippet`-typed `children` prop resolves, when the
  template uses children, or when a legacy component has a default slot (a template
  `<slot />` or a declared `$$Slots`, read off the `$$render` return's `slots` value by
  `hasDefaultSlot`). Legacy here is svelte2tsx's reading (`classifyRenderMode`: the
  return's `bindings` value is a string literal, a `__sveltets_$$bindings` call when it
  reads runes, anything else unrecognized), since analysis never sees the compiler's
  `runes` option. It's the one mode signal, shared with the legacy props path. It covers
  propless and template-only components. A runes component's `<slot />` is ignored, and a
  named slot alone doesn't count.
- **`docComment` precedence** — in-script JSDoc at or above `$props()` wins over the HTML
  `@component` comment, and `duplicate_comment` warns when both exist.
  - Type-only blocks (`@type`/`@typedef`) don't count (`hasDocContent`).
  - A component with no `$props()` gets only the HTML comment.
  - `@nodocs` is read from whichever source wins.
- **Legacy `export let`** — a component with no `$props()` whose instance script exports
  mutable bindings gets its props from the `$$render` return's `props` value instead
  (`svelte-legacy.ts`, one call site), through the same `extractPropsViaChecker` via a
  `PropsAnchor`.
  - Every prop is `bindable`. `defaultValue` is the initializer's text from the original
    script, the `export {a as b}` rename form included.
  - TS components read a type, and optionality is that type's: the literal svelte2tsx
    writes from the exports, or the author's reserved `$$Props`, which filters like a runes
    props type, with the `export let` names as the admitted ones. An `export let` name
    `$$Props` doesn't declare is dropped, since a typed consumer can't pass it. JS
    components have only an object literal, so the type comes from each binding's JSDoc
    `@type` and a prop is optional when it has an initializer.
  - Order is the exports' source order, then props only `$$Props` declares.
  - Accessors (`export const`, `export function`, `export class`) and type-only exports
    aren't props.
  - Slots and events aren't modeled, beyond the default slot setting `acceptsChildren`.
  - Only a component `classifyRenderMode` reads as legacy takes this path. One svelte2tsx
    reads as runes (a rune in the script) skips the scan: its exported bindings are
    instance exports, so no props and no diagnostic.
  - An unrecognized mode or props value yields no props and a `svelte_prop_failed` per
    export. That includes the empty props value svelte2tsx writes when it found no
    exports where the scan did; the known case is under Not Supported.
  - The in-script doc slot doesn't exist, so `docComment` is the HTML comment only.

### Incremental Analysis (`createAnalysisSession`)

A persistent handle backed by a `ts.LanguageService`, for consumers that re-analyze
repeatedly (the Vite plugin, a future LSP). `analyze()`/`analyzeFromFiles()` wrap
single-use sessions. The surface is `setFile`, `setFiles`, `deleteFile`, `has`, `list`,
`query`, `allIngestDiagnostics`, `getProgram`, and `dispose`. `session.ts` TSDoc is
authoritative.

- **Caching**
  - **Owned entries** (`Map<id, OwnedEntry>`) hold content, the svelte2tsx virtual,
    dependency edges, and ingest diagnostics.
  - An ingest compares content plus a mode-specific dependency key. A hit is a no-op; a
    miss re-ingests (svelte2tsx included) and version-bumps the LS.
  - Ingest is additive; callers remove files with `deleteFile`.
  - `getProgram()` is reference-stable until a version bumps, and parsed ASTs survive via
    the document registry.
- **Dependency resolution**
  - Lex+resolve is the default: a syntax-only TypeScript parse (`lexImports`) finds import
    specifiers, type-only ones included, which resolve in parallel.
  - Pre-resolved is the fast path: `SourceFileInfo.dependencies` (e.g. from Gro's filer)
    skips both steps, and the session trusts it unchecked.
  - Resolver cache identity is `ImportResolver.identity`. The default resolver is built
    lazily from the session's single tsconfig parse.
  - The session's resolution host sees owned files and the in-flight batch, so in-memory
    files get dependency edges.
- **Input order** — `query()` analyzes in sorted file-ID order and owned program roots are
  sorted, so the same files ingested in any order, in one batch or across many `setFile`
  calls, give identical output from a fresh session (limits under `compareStrings` above).
- **Context closure** (`contextClosure`, default `true`; `analyze()` passes `false`) — after
  each batch, the session reads the in-root, analyzable targets it doesn't own from disk
  and ingests them, transitively. Context files emit nothing and add no edges, but they're
  version-tracked instead of pinned at their first disk read. That keeps `internal/` edits
  live, and it's the only way a Svelte dependency the caller didn't supply gets a virtual.
  So a target is ingested even when it passes `isSource` (a module left out of `exports`,
  or the rest of the project when one component is handed over), marked `context` on its
  entry so it still emits nothing. Without it, every type drawn from an unsupplied
  component is `any`; TS files are walked too because a component can sit behind a barrel.
  Each ingest call sets the role (`SetFileOptions.context`): by default the files are
  inputs, so supplying a context file later promotes it, and a consumer forwarding an
  edit it doesn't mean as an input passes `context: true`.
- **Deferred resolutions** — a specifier that resolved to nothing isn't final.
  - When owned-set membership changes, the session calls the resolver's `invalidate()`.
  - A `setFiles` that adds paths retries the null slots of earlier lex+resolve entries
    (`healUnresolvedEdges`). This covers the watcher shape, where the created file arrives
    alone.

## Data Model

`ModuleJson[]` → `DeclarationJson[]` → `MemberJson[]`. Members never nest.

**ModuleJson** — `path` (relative to `sourceRoot`), `declarations`, `moduleComment`,
`dependencies`, `dependents`, `starExports`, `reExports`, `externalReExports`,
`externalStarExports`, and `partial` (a placeholder for a Svelte file whose transform
threw).

**DeclarationJson** — `v.variant('kind', …)` over 9 strict variants. Narrow with
`isKind(decl, 'function')`.

- `DeclarationKind`: `'type' | 'function' | 'variable' | 'class' | 'interface' | 'enum' |
  'component' | 'snippet' | 'namespace'`.
- `MemberKind`: `'function' | 'variable' | 'constructor'`.

**Shared fields** (all variants and members): `name`, `kind`, `docComment`,
`typeSignature`, `modifiers`, `sourceLine`, `genericParams`, `examples`,
`deprecatedMessage`, `internalMessage`, `seeAlso`, `throws`, `since`, `mutates`, and
`partial`. Top-level only: `alsoExportedFrom`, `aliasOf`.

| Field             | function | variable | class | interface | type | enum | component | snippet | namespace | FunctionMember | VariableMember | ConstructorMember |
| ----------------- | -------- | -------- | ----- | --------- | ---- | ---- | --------- | ------- | --------- | -------------- | -------------- | ----------------- |
| parameters        | ✓        |          |       |           |      |      |           | ✓       |           | ✓              |                | ✓                 |
| returnType        | ✓        |          |       |           |      |      |           |         |           | ✓              |                |                   |
| returnTypeInfo    | ✓        |          |       |           |      |      |           |         |           | ✓              |                |                   |
| returnDescription | ✓        |          |       |           |      |      |           |         |           | ✓              |                |                   |
| overloads         | ✓        |          |       |           |      |      |           |         |           | ✓              |                | ✓                 |
| members           |          |          | ✓     | ✓         | ✓    | ✓    |           |         |           |                |                |                   |
| props             |          |          |       |           |      |      | ✓         |         |           |                |                |                   |
| extends           |          |          | ✓     | ✓         |      |      |           |         |           |                |                |                   |
| externalTypes     |          |          | ✓     | ✓         | ✓    |      | ✓         |         |           |                |                |                   |
| implements        |          |          | ✓     |           |      |      |           |         |           |                |                |                   |
| acceptsChildren   |          |          |       |           |      |      | ✓         |         |           |                |                |                   |
| lang              |          |          |       |           |      |      | ✓         |         |           |                |                |                   |
| reactivity        |          | ✓        |       |           |      |      |           |         |           |                | ✓              |                   |
| typeInfo          |          | ✓        |       |           | ✓    |      |           |         |           |                | ✓              |                   |
| module            |          |          |       |           |      |      |           |         | ✓         |                |                |                   |
| optional          |          |          |       |           |      |      |           |         |           | ✓              | ✓              |                   |
| mergedValue       |          |          |       | ✓         | ✓    |      |           |         |           |                |                |                   |
| defaultValue      |          | ✓        |       |           |      |      |           |         |           | ✓              | ✓              |                   |
| alsoExportedFrom  | ✓        | ✓        | ✓     | ✓         | ✓    | ✓    | ✓         | ✓       | ✓         |                |                |                   |
| aliasOf           | ✓        | ✓        | ✓     | ✓         | ✓    | ✓    | ✓         | ✓       | ✓         |                |                |                   |

`ComponentPropJson`, `ParameterJson`, and `TupleElementJson` also carry `typeInfo`.
`ComponentPropJson` also carries `parameters` (snippets and callbacks) and
`returnType`/`returnTypeInfo` (callbacks only).
`ComponentPropJson` carries the shared doc fields (`docFields` in `types.ts`: `examples`,
`deprecatedMessage`, `seeAlso`, `throws`, `since`, `internalMessage`, `mutates`) plus
`description` and `defaultValue`; `ParameterJson` carries none of `docFields`.
`OverloadJson` carries `returnTypeInfo`.

**Contracts that span fields** (full statements on the `types.ts` field docs):

- **Flat strings are the checker's rendering, structured fields are normalized.**
  `typeSignature` keeps the checker's text, truncation included (for alias-lost types it
  isn't what editor hover shows), and member order, which can differ from the tree's
  written order. One exception: the checker widens optional properties and parameters with
  `undefined`, and every member-type position (a property member's `typeSignature`,
  prop/parameter `type`, `typeInfo`) strips it so `optional: true` carries it alone.
  - `null` is kept, and so is an `undefined`-only annotation.
  - Strips are top-level only in flat strings (`signatureToString` can't omit the
    widening), but happen at every optional position in trees.
  - Under `exactOptionalPropertyTypes`, property sites don't strip (`optionalWidened`),
    since every `undefined` there is author-written. Parameters and tuple elements always
    strip.
- **`externalTypes`** — contributions from external packages are dropped by *declaration
  origin* at every granularity: named properties, index signatures, and call/construct
  signatures, in intersections and through utility wrappers. Declaration-less
  (checker-synthesized) contributions fail open.
  - The dropped contributors are labeled by an AST walk of the written type that descends
    through project-local names (interface `extends`, alias right-hand sides, class
    chains, indexed access on local containers). Bound type parameters substitute their
    written arguments, and import renames resolve to exported names.
  - So `interface Props extends HTMLButtonAttributes` and
    `type Props = HTMLButtonAttributes & {…}` record the same bag.
  - Component props the `$props()` destructuring names are the one exception: they're
    documented (`admitNames` on `filterDocumentedProperties`), and their bag stays listed.
  - Home: `typescript-extract-shared.ts`. Unit tests: `external-properties.test.ts`,
    `external-composition.test.ts`.
- **Type-alias `members`** are enumerated only for object-like shapes
  (`hasExtractableProperties`): not unions, tuples, or external generic references.
  Components apply the same filtering unconditionally, so union prop types get
  `externalTypes` too.
- **Interface/class `externalTypes`** come from the heritage walk
  (`applyHeritageExternalTypes`), which names bags that `members` (own members only) never
  enumerates. `extends`/`implements` stay verbatim own-clause text; `extends` is always an
  array.
- **Class visibility** — public and protected are included; `private` and `#` are excluded.
  One rule (`isPrivateMemberDeclaration`) serves both the class's own declaration and any
  structural alias over the class. Getters and setters merge by name.
- **`defaultValue`** is verbatim author text (the initializer, or the `@default` tag),
  quotes included.
- **`sourceLine`** — synthesized aliases carry the local export specifier's line, and Svelte
  `<script module>` lines are remapped to the original source.
- **Default slot** — `export default …`, `export {x as default}`, and
  `export {default} from './x'` all carry `name === 'default'`. Renames *out* of the slot
  carry the new name plus `aliasOf: {module, name: 'default'}`. Svelte components use their
  filename-derived name.
- **Wire format** — array fields default to `[]` and flags to `false`. `compactReplacer`
  strips empties and `false` (except the `value` key, so a literal `false` node survives),
  and the parse helpers (`parseAnalyzeResult`, `parseModuleJson`, `parseDiagnostics`)
  restore them. The helpers are the stable, library-agnostic contract; the raw schemas
  are exported too. Array defaults are factories (`() => []`), since valibot returns a
  non-function default as-is and a literal `[]` would be shared across parses. String
  maps (`mutates`, `propertyDescriptions`) use a local `StringRecord` schema, since
  `v.record` drops `constructor` and `prototype` keys.

## Key Design Decisions

### Module Paths in Printed Type Text

The checker prints module objects as `typeof import("<absolute path>")` in `typeSignature`,
`returnType`, and `TypeJson` `text`, which would leak local paths and make output
machine-dependent. `normalizeModulePathsInTypes` (`analyze-core.ts`) rewrites each path by
tier:

1. an emitted module becomes exactly its `ModuleJson.path`, usable as a lookup key
2. a package becomes the tail after the last `node_modules/`
3. anything else becomes `relative(projectRoot, …)` — a `../` prefix means "outside this
   project"

Only paths naming a file the program loaded are rewritten, so string-literal types are
safe, and non-type-text keys (`NON_TYPE_TEXT_KEYS`) are skipped. It runs as one
whole-output pass, so a new printing site can't miss it.

### Diagnostic Collection

- **The envelope** — `AnalyzeResultJson` is `{modules, diagnostics}`, both defaulting to
  `[]`, and round-trips through `JSON.stringify`/`parseAnalyzeResult`. Diagnostics
  accumulate without halting. A declaration or member whose extraction failed mid-flight
  carries `partial: true`, so consumers can spot incomplete data without cross-referencing.
- **`Diagnostic.file`** — project-root-relative, with a `../` form for out-of-root files.
  - Producers emit the absolute id, and `normalizeDiagnosticPaths` relativizes it.
  - `message` gets the same path and virtual-suffix scrub.
  - Virtual positions are remapped to `.svelte` positions first; `finalizeDiagnostics`
    owns that ordering, and an unmappable position drops its line and column.
- **Severity** is fixed per kind: `transform_failed` and `module_unreadable` are errors;
  everything else is a warning. `duplicate_declaration` emits only under the opt-in
  `onDuplicates`, whose `'warn'` and `'throw'` modes add a log or a throw.
- **Categories**
  - **Ingest-time** kinds (`transform_failed`, `source_map_failed`, `import_parse_failed`,
    `resolver_failed`) come back from `setFile`/`setFiles` and persist on the entry.
    `allIngestDiagnostics()` is the cumulative view.
  - **Query-time** kinds are recomputed on every `query()`.
  - **Discovery-time** (`module_unreadable`) is merged by `analyzeFromFiles`. Session
    consumers own it; the Vite plugin keeps it in a side channel.
- **`alias_lost`** fires on an exported type alias whose name the checker dropped and that
  neither recovery channel heals. It's gated on a registry being present, a loss-capable
  right-hand side, not being a literal union or brand, and not `@nodocs`. The fix on the
  author's side is a nominal symbol (`interface Foo extends z.infer<typeof S> {}`).

### Re-Export Philosophy

The opt-in `findDuplicates` check flags duplicate names across modules by canonical
identity, after resolving `aliasOf` chains. `@nodocs` exempts a declaration. Encodings
(mechanics in `typescript-exports.ts` and `postprocess.ts`):

- **Same-name** re-export → `alsoExportedFrom` on the canonical, plus the forward edge
  `ModuleJson.reExports` (`{name, module, typeOnly, sourceLine}`) on the re-exporter.
  - **Position 3**: if the export statement carries its own JSDoc, an alias is *also*
    synthesized in the re-exporting module, so the local content has a home.
- **Renamed** re-export → a synthesized declaration with `aliasOf`: a full re-analysis of
  the canonical, with `sourceLine` at the local specifier.
- **Star exports** → `starExports`, when the target emits a module; its projected bindings
  are never materialized in the projecting module, whatever their kind. A star over a
  module that emits nothing (gated, or outside the analyzed inputs) has no entry and is
  read as the named same-name re-exports it stands for (`collectMaterializedStars`), each
  binding going through the arms below with ES star semantics: no `default`, local
  exports shadow, names two stars disagree on are excluded, and a name an emitted star
  also provides stays with that star.
- **External** (the immediate target is a package) → `externalReExports` /
  `externalStarExports`. These are flat statement facts. Import-then-export and indirect
  chains leave no trace.
- **Gated canonicals** (project-local but excluded, e.g. `internal/`) → a full alias
  synthesized even for a same-name re-export, since the canonical emits nothing to link.
  `aliasOf.module` then dangles by design, and no `reExports` edge is emitted. Any
  canonical outside the analyzed inputs is treated the same, source-scope or not (a
  context file, a module left out of `exports`): the predicate is
  `ExtractContext.isEmittedFile` (`IsEmittedFile`, the emitted set), not `isSource`, so a
  `reExports` edge never points at a module the output lacks, and neither does a
  `starExports` entry. A component with no virtual (transform failed, or unsupplied with the closure off)
  re-exports as a `partial` component (`virtuallessSvelteTarget`, which lists its
  limits).
- **Namespace** re-exports (`export * as ns from './x'`) → `NamespaceDeclarationJson` whose
  `module` points at the projected source. It's detected via `ValueModule` before
  `analyzeDeclaration`, which would otherwise leak `typeof import(...)`.
- **Svelte component** re-exports → a `kind: 'component'` placeholder. Phase-2
  `resolveComponentAliases` fills props and docs from the canonical, filling gaps only;
  gated canonicals are supplied as lookup-only context. Only the component (the virtual's
  default export) gets the placeholder: a re-exported `<script module>` function or type
  is analyzed as what it is.

Statement-level `@nodocs` suppresses the entry in every encoding. `resolveExportSurface`
combines all of them into a module's full export surface with ES star semantics (explicit
beats star, ambiguous stars are excluded, `default` never projects), and it reports
unresolvable stars instead of guessing.

Lock-in tests: `src/test/analyze.reexport-{edges,namespace,forward,gated}.test.ts` and
`postprocess.surface.test.ts`.

### Not Supported

- Standalone `namespace Foo {}` declarations document as a bare `kind: 'variable'`; the
  `export * as ns` form is supported. Decorators aren't modeled.
- `@nodocs` on members (class, interface, type alias, enum) and component props is ignored
  with no warning; the member and prop extractors never read it.
- Indirect external re-exports, unresolvable specifiers, type-only-ness of
  `export type * from`, and the type-only marker on a renamed value
  (`export type {c as d} from`) are all silently dropped.
- `ParameterJson` deliberately has no doc fields like `examples`/`since`, unlike
  `ComponentPropJson`.
- An instance script closed with whitespace before the `>` (`</script >`): Svelte and
  `findScriptTags` accept it, svelte2tsx's tag matcher doesn't, so the virtual has no
  script. A legacy component written that way documents no props, with a
  `svelte_prop_failed` warning per `export let`.
- A runes component that renders its children through `<slot />` reports
  `acceptsChildren: false`; only a legacy component's default slot sets it.
- Legacy components: named slots, slot props, and events aren't modeled. Two export forms
  follow svelte2tsx's props value where it departs from Svelte. A binding exported both
  directly and through a renaming clause (`export let a; export {a as b}`) keeps only `b`,
  without the binding's JSDoc; TS reads it as optional, JS by the initializer like any
  other prop. An export clause written above its binding loses the binding's JSDoc
  (the type still resolves), and in TS reads as optional.

## API

- `analyzeFromFiles()` — one-shot, with file discovery from disk
- `analyze()` — one-shot; you supply `SourceFileInfo[]`
- `createAnalysisSession()` — incremental (the Vite plugin, LSP-style tools)

All three produce `AnalyzeResultJson`. The CLI and the Vite virtual module emit the same
shape through `compactReplacer`, so parse through `parseAnalyzeResult` to restore defaults.
Consumers own package metadata; see `LibraryJson` in `@fuzdev/fuz_util` for the fuz
pattern.

### CLI

`npx svelte-docinfo [project-root]` writes compact JSON to stdout; `--pretty` and
`-o <file>` adjust that. `--tsconfig <path>` picks a config and `--no-tsconfig` analyzes
without one. The full flag table is in `README.md` and in `cli.ts`, whose help
text interpolates the defaults.

- `--only <glob>` filters output modules after full analysis; diagnostics aren't filtered.
- Exit codes: 0 success, 1 analysis errors, 2 CLI errors or a thrown analysis error.

### Ecosystem Integration

fuz_ui and fuz_css consume `virtual:svelte-docinfo` directly: a hand-written
`src/routes/library.ts` combines `modules` with `virtual:pkg.json` via fuz_util's
`library_json_from_modules()`, feeding fuz_ui's `Library`. See the fuz-stack skill's
`references/documentation-system.md`.

## Dependencies

- **Runtime**: `commander`, `tinyglobby`, `picomatch`,
  `@jridgewell/trace-mapping`, and `valibot` (the output schemas). `valibot` is a regular
  dependency, not a peer: consumers validating through the parse helpers never import it.
- **Peers** (required):
  - `svelte` 5+ and `svelte2tsx`, eagerly imported by every entry, so they're needed even
    for TS-only analysis.
  - `typescript` 5.9+ or 6, so consumers don't carry a second TS.
- **Peers** (optional): `vite` 6+, for the Vite plugin only (it uses `server.environments`).
- **Not a dependency**: `zod`. Nothing under `src` imports it, and a test in
  `types.test.ts` guards that, since it still resolves locally as a peer of dev
  dependencies such as `@fuzdev/gro`.
  Tests and fixtures that need a real schema library to analyze use `valibot`.

## Testing

Tests live in `src/test/` and import source via `#lib/*.ts`. Fixtures
(`src/test/fixtures/{tsdoc,ts,svelte}/`) hold an input plus a generated `expected.json`:

- **tsdoc** captures `parseComment` output.
- **ts** and **svelte** capture the whole module plus diagnostics. Each fixture runs through
  `analyzeCore` on its own.
- **Multi-file** fixtures (siblings beside the entry) capture the whole envelope. `internal/`
  siblings exercise gated canonicals, and the ts side's `external/` maps to `node_modules/`.

Mapping rules and guards: `src/test/fixtures/CLAUDE.md`. Regenerate with
`gro src/test/fixtures/update`, or one set with `gro src/test/fixtures/ts/update`.

`examples.test.ts` runs the example scripts and needs `npm run build` and
`npm run setup-examples` first.

## Development

```bash
gro check     # typecheck, test, gen --check, format --check, lint
gro test      # run tests
gro gen       # run code generators
```

`vite.config.ts` imports the plugin from source (`./src/lib/vite.ts`), not via the
`svelte-docinfo/vite.js` self-reference: Gro resolves the Vite config before building, so a
`dist/` import breaks `gro check` on a fresh checkout. Vite bundles the config once at startup,
so restart the dev server to pick up `src/lib` changes. The packaged entry is exercised by the
examples.

**Standards**: TypeScript strict mode, Svelte 5 runes, tabs, 100-char width, tests in
`src/test/` (not co-located), and real source extensions in imports (`.ts`, `.svelte`; the
build rewrites them to `.js` in `dist`).
