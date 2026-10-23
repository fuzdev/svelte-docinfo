# svelte-docinfo

> static analysis for TypeScript and Svelte

Extracts structured metadata from TypeScript and Svelte 5 source via the TypeScript
compiler API — full type inference instead of manual annotations. Build-tool agnostic;
consumers add package metadata and formatting. Use cases: docs, code search, dev tools.

Conventions: [fuz-stack skill](https://github.com/fuzdev/fuz_docs), with one deliberate
divergence: the API is **camelCase**, since the package serves the broad Svelte ecosystem.
For the same reason `@fuzdev/fuz_util` is dev-only: `src/lib` never imports it, hence the
local `toErrorMessage` and `mapConcurrent`.

**This file is the map.** Behavioral policy lives in TSDoc beside the code; each section
points to the TSDoc that owns it, so read that before changing behavior. User-facing docs
are the tomes in `src/routes/docs/`. Examples: `examples/vite/`, `examples/api/`,
`examples/cli/`.

## Capabilities

- **Type resolution** — imported types, generics, inferred types. Every member type is
  checker-backed.
- **Structured types** — optional `typeInfo` (`TypeJson`, a recursive 10-kind valibot
  schema) beside the flat type strings, on variables, type aliases, variable members,
  component props, parameters, and tuple elements; `returnTypeInfo` on functions, function
  members, and overloads. Policy: the `TypeJson` schema TSDoc (`types.ts`) and
  `typescript-extract-type-json.ts`.
  - **Absence** — absent when the flat string is the whole story (intrinsics, bare
    references, object/function roots); relaxed at type-alias roots, where the flat string
    is just the alias name, and at recovered roots.
  - **Shape** — union/intersection members keep alias names. Union members take the written
    order (the alias right-hand side, else the site annotation, falling back to the
    checker's order), nullish last. A lost union written as one member (`Lost | null`, at
    the site or in an alias right-hand side) stays one `reference` member at its written
    position. `true | false` collapses to `boolean`; the optional-widening `undefined` is
    dropped. Literal `value`s JSON can't carry (bigint, non-finite) are strings. Named
    generic instantiations are `reference` nodes with `typeArgs`; other callables are
    `function`. Object literals and functions stay terminal `text`, untruncated up to 1000
    chars, then the checker's shortened rendering. Depth caps at 5, degrading to
    `{kind: 'other'}`.
  - **Name recovery** — TypeScript drops the alias of a type over an indexed access or
    conditional (`z.infer<typeof S>`). svelte2tsx-generated aliases count as none
    (`linkableAliasSymbol`). Two channels recover `{kind: 'reference', name}`: the
    **written** channel resolves the site's annotation through import renames
    (`specifierExportedName`), and the **registry** channel (`buildAliasRegistry`) matches
    by type identity against exported, non-`@nodocs`, non-generic lost aliases of emitted
    modules, so unannotated positions recover too; its hits carry `module`, always an
    emitted module. Never name what
    the project didn't declare. Unrecovered losses emit `alias_lost`.
- **Member projection** — type-alias and interface properties share
  `populatePropertyMember`: a callable becomes `kind: 'function'`, anything else gets
  `typeSignature` + `typeInfo`. External-origin call signatures are filtered first, so
  `run?: typeof spawn` stays a `variable`. Class fields stay `variable` even when
  function-typed. Interfaces enumerate own members only. Literal member names are unquoted
  (`memberNameText`); computed names are skipped.
- **TSDoc/JSDoc** (`tsdoc.ts`) — `@param`, `@returns`, `@throws`, `@example`,
  `@deprecated`, `@internal`, `@see`, `@since`, `@default`, `@module`, `@nodocs`,
  `@mutates`. `@return` is read as `@returns`, and `@defaultValue`/`@defaultvalue` as
  `@default`.
  - `@internal` is a marker (`internalMessage`), not an exclusion. `@nodocs` removes a
    declaration from docs and duplicate checking; it applies to declarations and export
    statements only.
  - Module comments parse through the same `parseComment` (`parseModuleComment` rewraps
    the text, `@module` lines dropped, for TS, Svelte script, and HTML comments alike):
    prose is `moduleComment`, and `@example`/`@deprecated`/`@see`/`@since`/`@internal`
    land on the module's same-named fields (`toModuleDocFields`). Declaration-only tags
    (`@param`, `@returns`, `@mutates`, `@throws`, `@default`, `@nodocs`) warn
    `misplaced_tag` and drop (`warnModuleCommentTags`); unknown tags drop silently.
    In a module comment only a line-leading `@` starts a tag (`parseCommentText`);
    declarations follow TS. A block is a module comment only by a `@module` line.
  - `@mutates` splits target from description at ` - `. Dotted `@param obj.prop` fills
    `ParameterJson.propertyDescriptions`, including the tags TS nests under a braced
    `@param {object} obj` (`collectParamTag`).
  - A parameter is `optional` whenever a caller may omit it (`checker.isOptionalParameter`:
    `?`, an initializer, JS `@param {T} [b]` or `{T=}`), in TS and JS alike. A bracketed
    `[b=0]` supplies `defaultValue` when there's no initializer (`jsdocParamTagDefault`).
  - `@default` lands on variables, component props, and function/variable members, never
    on top-level functions, overloads, or constructors.
  - Text is kept raw (inline `{@link}` survives); rendering is the consumer's concern.
- **Overloads** — every public signature with its own JSDoc. `@param`/`@returns` flow to
  their overload; one overload's JSDoc documents the symbol (the first signature's, or the
  visited declaration's when merging reorders them), and symbol-scope tags on any other
  overload emit `misplaced_tag`. A JS `@overload` (`jsdocOverloadSignatures`)
  documents like a TS overload: its JSDoc is the block hosting the tag, its own
  `@param`/`@returns` tags nested in its `JSDocSignature` (`parseOverloadSignatureComment`),
  and the implementation's block is hidden as a TS implementation's JSDoc is. Functions,
  arrows, methods, and constructors alike; never accessors, which the checker doesn't
  overload.
  - The primary overload is the one the member's docs come from, by identity, when the
    signatures are the parent's own (`ownsSignatureDeclarations`): a JS overload sharing
    its block, a TS overload that declaration, so another one repeating its prose still
    warns, and an interface merged ahead of a class doesn't shift it. Signatures borrowed
    through a type (`m: typeof g`, `@property {typeof g} m`) have no primary (the member's
    docs are its own, never the lender's), so every overload's tags warn.
- **Merged value+type symbols** — `const Foo = z.strictObject(...)` +
  `type Foo = z.infer<typeof Foo>` documents the type (`selectDeclarationNode`), with
  `mergedValue: true` (also a runtime value; `generateImport` emits a value import). When
  the type has no JSDoc, the const's is used. Class+interface merges document the class.
- **JSDoc type declarations (JS)** — `@typedef`/`@callback` tags are type aliases
  (`isTypeAliasLike`; `typeAliasTypeNode`/`typeAliasTypeParameters` read the right-hand side
  and `@template`s), so every alias path treats them like `type A = …`: `@property` members,
  a `@callback`'s `(call)` member with its `@param`/`@returns` text, written union order, the
  alias registry, `alias_lost`, and `const A` + `@typedef A` merging with `mergedValue`. Docs
  follow TypeScript's hover, except as noted: a block declaring a typedef without a
  `@param`/`@returns` is a typedef block (`isTypedefBlock` in `tsdoc.ts`), which the
  declaration below skips, prose and tags alike (in `.ts` files too); its typedef takes the
  prose and tags unless the block declares several (`typedefOwnsBlock`). A function doc block
  stays the function's, leaving its typedef only the tag's own comment (stricter than hover,
  as is the several-typedef case). A module comment, a component comment, or the in-script
  component JSDoc keeps its prose, its typedef tags dropping as unknown ones; a `@typedef` in a
  component's HTML `@component` comment, which svelte2tsx copies onto the generated component
  statement, documents nothing and never registers (`isStrayComponentTypedef`, a structural
  test that fails open if svelte2tsx moves the copy). A `@enum` const is `kind: 'enum'` over
  its value (`isJSDocEnumSymbol`). TS binds none of these in `.ts` files.
- **JSDoc annotations (JS)** — read as the checker reads them: `@template` tags are
  `genericParams` on functions, arrows, function expressions, classes, and methods
  (`signatureTypeParameters`; an `@overload`-ed implementation's are its first
  overload's, each overload's its block's), and a `@type`/`@param`/`@property`/`@returns`
  type is the site's written annotation (`writtenTypeAnnotation`, `writtenReturnTypeNode`,
  `writtenGetterTypeNode`), feeding written-name recovery and written union order like a TS
  annotation. A `.ts` file's JSDoc types annotate nothing.
- **Svelte 5 components** — props, generics, snippets, and `acceptsChildren` via svelte2tsx
  and the checker, including JS components and legacy `export let` components (see Svelte
  Component Analysis).
- **Runes** — `$state`, `$state.raw`, `$derived`, `$derived.by`, detected syntactically in
  every file (`reactivity`).

## Architecture

### Modules

**Low-level** (compiler API)

- `typescript-program.ts` — `createAnalysisProgram` (one-shot `ts.Program`),
  `createAnalysisLanguageService` (persistent LS), `loadTsconfig`, `RootFileNames`.
  - `loadTsconfig` parses relative to the config's own directory (as `tsc -p` does) and
    throws when the config or its `extends` chain fails to load (SvelteKit's tsconfig before
    `svelte-kit sync`); option-level diagnostics and TS18003 don't throw. `tsconfig: false`
    uses `DEFAULT_COMPILER_OPTIONS` (strict, since TS's own defaults are non-strict before
    6); it's explicit, never a fallback.
  - `rootFileNames` replaces the program's roots, which otherwise scale cold cost with the
    project. Narrowing changes output only for ambient types in a file nothing imports
    (they become `any`); `declarationFileRoots` keeps the `.d.ts` roots. Every entry point
    forwards `tsconfig`, `compilerOptions`, and `rootFileNames` (the CLI only `tsconfig`, as
    `--tsconfig`/`--no-tsconfig`).
  - `createIsExternalFile`/`createIsExternalPath`: outside the root, under `node_modules`,
    or a `.d.ts` outside the source root. A different axis from `isSource`.
  - Virtual files are `VirtualFileEntry` (`{content, scriptKind?}`). Both hosts answer
    `directoryExists` from served files (`createOwnedDirIndex`), so in-memory files in
    directories absent from disk resolve.
  - A program with Svelte virtuals also roots svelte2tsx's `svelte-shims-v4.d.ts`
    (`getSvelteShimRoots`); without it every component is `any`. Generated aliases
    (`$$ComponentProps`, the shims' `__sveltets_2_PropsWithChildren`) are nameless to the
    `TypeJson` builder (`linkableAliasSymbol`, `isSvelteShimPath`), though flat strings
    print them as the checker does.
- `typescript-extract-*.ts` — per-kind extractors, `@internal`, imported directly (no
  barrel):
  - `-shared.ts` — `ExtractContext` (pass-constant: checker, diagnostics,
    `isExternalFile`, `isEmittedFile`, `aliasRegistry`, `exactOptionalPropertyTypes`) via
    `createExtractContext`; declaration kind inference and selection; signature/property
    projection (`populateCallableMember`, `populatePropertyMember`); the optional-widening
    gate (`optionalWidened`); external filtering (`filterDocumentedProperties`,
    `applyHeritageExternalTypes`); class visibility (`isPrivateMemberDeclaration`); rune
    detection.
  - `-function.ts`, `-type.ts` (aliases, interfaces, enums), `-class.ts`,
    `-type-properties.ts` (alias property enumeration, `hasExtractableProperties`).
  - `-type-json.ts` — `resolveTypeInfo` (the `TypeJson` builder), registry types, and the
    policy primitives the flat-string paths share (`optionalWideningTarget`,
    `referenceSymbolName`, tuple helpers), so strings and trees can't drift.
- `typescript-alias-registry.ts` — `buildAliasRegistry(sources, checker)`. `analyzeCore`
  runs it; direct `analyzeModule`/`analyzeSvelteModule` callers run it themselves or get
  written-channel recovery only.
- `typescript-exports.ts` — `analyzeTypescriptModule`, `analyzeExports`,
  `analyzeDeclaration`, `extractModuleComment`: alias chains, namespace classification,
  re-export JSDoc routing, merged symbols, `alias_lost`.
- `tsdoc.ts` — `parseComment`, `applyToDeclaration`, `cleanComment`, `hasDocContent`,
  and the text-level `parseCommentText`/`parseModuleComment`/`toModuleDocFields`.
- `diagnostics.ts` — `Diagnostic` (a union on `kind`), `DiagnosticKind`,
  `DiagnosticSeverity`, `parseDiagnostics`, read helpers (`hasErrors`, `errorsOf`,
  `byKind`, `formatDiagnostic`, …).
- `log.ts` — `AnalysisLog` (`info`/`warn`/`error`): progress, separate from diagnostics.

**Mid-level**

- `svelte.ts` — `analyzeSvelteModule`, `transformSvelteSource`; script and module-comment
  extraction from the *original* source; render mode (`classifyRenderMode`); props anchors
  (`resolveRunesPropsAnchor`, `resolveExportLetPropsAnchor`); snippet helpers;
  `remapVirtualDiagnosticPositions`.
- `svelte-scripts.ts` (`@internal`, not in the barrel) — `findScriptTags`,
  `scanScriptTags`, `isModuleScript`, `findHtmlComments` (skips script and style text).
- `svelte-legacy.ts` (`@internal`, not in the barrel) — `scanLegacyExports`,
  `resolveLegacyPropsAnchor`.
- `source.ts` — `SourceFileInfo`, file-type predicates, virtual-path helpers
  (`stripVirtualSuffix`, `SVELTE_VIRTUAL_SUFFIX`), `isSvelte2tsxGeneratedExport`,
  `getDefaultAnalyzer`.
- `paths.ts` — `toPosixPath`, `isAbsolutePosixPath`. Every stored, compared, or keyed path
  is POSIX; native paths are accepted at public boundaries.
- `dep-resolver.ts` — `ImportResolver` (`{resolve, identity, invalidate?}`),
  `ResolveImport`, `normalizeResolveImport`, `createDefaultResolver` (TS resolution plus a
  `.svelte` fallback), `lexImports` (syntax-only parse), `noDepsResolver`.
- `concurrency.ts` — `MAX_FILE_CONCURRENCY`, `MAX_RESOLVE_CONCURRENCY`, `mapConcurrent`.
- `error.ts` — `toErrorMessage`.
- `schema.ts` (not in the barrel) — `parseWithSummary` (the `parse*` helpers throw through
  it, listing every issue) and the `@nodocs` `Named` alias; a leaf importing only valibot.
- `source-config.ts` — `ModuleSourceOptions`, `DEFAULT_SOURCE_OPTIONS`,
  `createSourceOptions`/`normalizeSourceOptions`, `ExcludeOption`, `isSource`,
  `extractPath`, `extractDependencies`, include widening
  (`createSourceOptionsWithInclude`), the baseline exclusions.
- `types.ts` — the output schemas (valibot): `ModuleJson`, `DeclarationJson`, `MemberJson`,
  `TypeJson`, `OverloadJson`, …, plus `parseModuleJson`. Field-level policy lives here.
  Non-recursive object schemas are typed through `@nodocs` `FooSchema` interfaces
  (`extends Named<typeof FooImpl>`); the recursive `TypeJson`/`TupleElementJson` are
  `v.GenericSchema<…>`. That keeps emitted declarations referential and small: an inlined
  `ModuleJson` sends consumers past TS's instantiation depth (TS2589).
  `diagnostics.ts` and `AnalyzeResultJson` follow suit; `dist-types.test.ts` guards it.
- `declaration-build.ts` — permissive build types (`DeclarationJsonBuild`,
  `MemberJsonBuild`: every field optional but `kind`) and the per-module analysis records
  (`ModuleAnalysis`, …). The schemas validate at `parseModuleJson`.
- `declaration-helpers.ts` — `getDisplayName`, `generateImport`, `compactReplacer`,
  `isKind`, and the renderer contract `typeJsonToTokens`/`typeJsonToText` (a corpus test
  tokenizes every fixture tree).
- `postprocess.ts` — pure passes: `mergeReExports`, `resolveComponentAliases`,
  `findDuplicates`, `sortModules` (phase 2), and `computeDependents` (run by
  `session.query` before `analyzeCore`); `resolveExportSurface`; `compareStrings`.
  - `compareStrings` orders all output; never bare `localeCompare` or a default `.sort()`.
  - Input order is sorted too (`query()`'s owned set, LS program roots, `globFiles`,
    `discoverFromExports`), so output is a function of the file set, not crawl or ingest
    order. It matters because TS prints an origin-less union in type-creation order, and
    root order sets declaration-merge order. Known limits (an unrelated edit, or
    `getProgram()` checker work before the first `query()`, can reorder such unions) are in
    the `AnalysisSession` "Input order" TSDoc.

**High-level**

- `analyze.ts` — one-shot `analyze` and `analyzeFromFiles`, each a single-use session.
- `session.ts` — `createAnalysisSession` (see Incremental Analysis).
- `analyze-core.ts` — `analyzeCore` (the two-phase loop), `analyzeModule`,
  `finalizeDiagnostics`, `normalizeDiagnosticPaths`, `normalizeModulePathsInTypes`,
  `OnDuplicates` (the opt-in flat-namespace check; any mode emits `duplicate_declaration`),
  and the envelope schemas `AnalyzeResultJson`/`AnalyzeResultJsonWire` with
  `parseAnalyzeResult`.
- `vite.ts` — default export `svelteDocinfo`, serving `virtual:svelte-docinfo`. Vite 6+,
  per-environment dev APIs only; one dev server at a time. The module TSDoc owns the
  lifecycle and restart policy; `vite.dev.test.ts` drives real middleware-mode servers.
  - Hooks: `configResolved`, `buildStart`, `buildEnd` (disposes the session),
    `resolveId`/`load`, `configureServer` (watch plus debounced re-analysis, gated on
    `isSource(file) || session.has(file)`).
  - Only the files discovery selected are inputs. Other edits pass with the context role,
    and an `add` re-runs discovery, aiming at dev output that matches a cold build of the
    same tree. Changed output reloads the page (no HMR boundary: the module is data).
  - Types live in the root `virtual-svelte-docinfo.d.ts`; its header explains why.

**Filesystem helpers** — `discovery.ts` (`discoverSourceFiles`), `files.ts` (`loadFile`,
`globFiles`, `deriveIncludePatterns`), `exports.ts` (`parsePackageExports`,
`discoverFromExports`, `createBlockedSpecifierChecker`).

**CLI** — `cli.ts` (`runCli`, commander) and `main.ts` (shebang entry, `dist/main.js`).

**Other** — `logo.ts` (docs-site SVG data, not in the barrel).

**Barrel**: `svelte-docinfo` re-exports the common surface; `./*.js` and `./*.ts` subpaths
expose every module's full API.

### Two-Phase Analysis

`analyzeCore` runs, in order:

0. **Alias-registry pre-pass** — `buildAliasRegistry` over the emitted set, Svelte modules
   read through their virtuals.
1. **Module analysis** — dispatch by file type (TS, Svelte, CSS, JSON), collecting
   declarations and re-export facts; a Svelte file whose transform failed gets a `partial`
   placeholder.
   - Then owned Svelte files that emit nothing (`contextSvelteFiles`: gated, or ingested as
     context) are analyzed only when an emitted component alias references them, as
     lookup-only context.
2. **Linking** — `mergeReExports`, `resolveComponentAliases`, `sortModules`,
   `findDuplicates` (only with `onDuplicates`), then `normalizeModulePathsInTypes` and
   `finalizeDiagnostics`, which rewrite phase 2's output in place.

### Sources and Scope

- **Vocabulary** — *owned*: ingested by the session. *Source* (emitted): owned, passing
  `isSource`, and not a context file; only these produce a `ModuleJson`. *Gated*: in-root
  but failing `isSource` (e.g. `internal/`): visible to the checker, never emitted.
  *Context*: files the session reads from disk itself (gated ones, plus source
  dependencies nobody supplied), and any file supplied with `context: true`. *External*: a
  package, an out-of-root file, or a `.d.ts` outside the source root — a separate axis
  from gating.
- **`SourceFileInfo`** — `{id, content, dependencies?}`, from disk, memory, or a build
  pipeline. Owned content is served to the checker before the disk fallback; `query()`
  gates emission through `isSource` (under `sourcePaths`, not matching `exclude`).
- **Reverse edges** — `dependents` come from `computeDependents` over the emitted set's
  forward edges, never from the caller.

**Discovery** (`discovery.ts`, `exports.ts`, `source-config.ts`):

- **Modes** — `'auto'` (default: `package.json` exports, falling back to globs),
  `'exports'` (strict: throws when exports is missing or resolves to no source files, or
  when several `sourcePaths` share no common prefix), `'glob'`. `include` collapses
  `'auto'` to glob; combining it with `'exports'` throws.
- **Include widening** — each include pattern's static base joins `sourcePaths`
  (`createSourceOptionsWithInclude`, shared by `analyzeFromFiles` and the Vite plugin). A
  root-crossing pattern makes the whole project root source, and logs it.
- **`exclude`** — one field, applied at discovery and at `isSource`. Default
  `['**/*.test.ts', '**/*.spec.ts', '**/internal/**']`; an array replaces it, a
  `(defaults) => patterns` callback extends it.
- **`src/lib/internal/`** — modules that ship for public modules to import but aren't
  documented, usually paired with an `"./internal/*": null` exports key, which exports
  discovery honors with Node's best-match semantics (`createBlockedSpecifierChecker`).
- **Always-on guards** — outside the default `exclude`, since a user `exclude` replaces it
  wholesale. `node_modules` and dot-directory segments below a source path are never
  source, matched relative to that path (an explicit dot-dir `sourcePaths` entry works;
  `dist`/`build` aren't excluded). `sourcePaths`/`sourceRoot` entries and absolute patterns
  outside `projectRoot` throw; in-root absolute paths relativize. `'/src/lib'` is
  filesystem-absolute, not shorthand.

### Svelte Component Analysis

Svelte 5+ only, enforced at runtime (svelte2tsx output changed too much across versions).
The workflow is in the `analyzeSvelteModule` TSDoc; the policies:

- **Virtuals** — each `.svelte` file becomes a `.__svelte2tsx__.ts` virtual the checker
  sees; the raw `.svelte` never reaches the LS. `.svelte` imports map to virtuals via
  `resolveSvelteVirtualSpecifier`. `<script module>` exports analyze through the virtual,
  with svelte2tsx internals filtered (`isSvelte2tsxGeneratedExport`) and positions
  remapped to the original source.
- **Script tags** — only a top-level `<script>` is the instance or module script, as in
  Svelte. `findScriptTags` (`svelte-scripts.ts` TSDoc) settles the scripts-first case by
  regex (`provenTopLevel`) and otherwise asks Svelte's parser. It runs once at transform;
  the result rides the virtual (`SvelteVirtualFile.scriptTags`).
- **Render mode** — legacy or runes is svelte2tsx's reading (`classifyRenderMode`, off the
  `$$render` return's `bindings`), since analysis never sees the compiler's `runes` option.
- **Props** — `extractPropsViaChecker` projects them from a `PropsAnchor`: the props type
  plus what the script says of each prop, from `$props()` (`resolveRunesPropsAnchor`) or,
  on a legacy component, the exports (`resolveExportLetPropsAnchor`). Local props come in
  source order. External-origin props are filtered (see `externalTypes`), except names the
  script binds (the destructuring's, or the `export let` names), which are admitted with
  their external type and JSDoc, after the local props in destructuring order (a legacy
  component orders everything by its exports). The rest element, a name the type lacks, and
  an index-signature-only name admit nothing. JS
  components read the JSDoc `@type` on `$props()` or svelte2tsx's synthesized typedef.
  `defaultValue` is verbatim source text.
- **Callback props** — a prop whose type has a call signature the project declared
  (`localCallSignature`) carries `returnType`/`returnTypeInfo` and any `parameters`.
  `returnType` is the marker: snippets have `parameters` without it. Full statement: the
  `returnType` field doc in `types.ts`.
- **`acceptsChildren`** — a `Snippet`-typed `children` prop, template use of children, or a
  legacy component's default slot (`<slot />` or a declared `$$Slots`, via
  `hasDefaultSlot`). A runes component's `<slot />` and named slots don't count.
- **`docComment`** — in-script JSDoc at or above `$props()` beats the HTML `@component`
  comment (`duplicate_comment` warns when both exist); type-only blocks don't count
  (`hasDocContent`), and `@nodocs` is read from the winner.
- **HTML `@component` comment** — read from the original source, not svelte2tsx's re-emitted
  JSDoc: the first HTML comment with a line starting `@component`, parsed like an HTML
  module comment (`parseHtmlComponentComment`). svelte2tsx, and so editor hover, takes the
  last comment containing `@component` anywhere; when the two picks differ and in-script
  JSDoc doesn't supply the doc, `component_comment_mismatch` warns.
- **Legacy `export let`** (`svelte-legacy.ts` TSDoc) — every prop is `bindable`; type and
  optionality come from svelte2tsx's props literal or the author's `$$Props` (an
  `export let` it doesn't declare is dropped), else (JS, or TS whose exports are all untyped
  and uninitialized) from each binding's JSDoc `@type` and initializer. Accessors and
  type-only exports aren't props; slots and events aren't modeled. An unrecognized mode or
  props value yields no props and a `svelte_prop_failed` per export. `docComment` is the
  HTML comment only.

### Incremental Analysis (`createAnalysisSession`)

A persistent handle backed by a `ts.LanguageService`, for repeated re-analysis (the Vite
plugin, a future LSP); `analyze()`/`analyzeFromFiles()` wrap single-use sessions. Methods:
`setFile`, `setFiles`, `deleteFile`, `has`, `list`, `query`, `allIngestDiagnostics`,
`getProgram`, `dispose`. `session.ts` TSDoc is authoritative.

- **Caching** — owned entries hold content, the svelte2tsx virtual, dependency edges, and
  ingest diagnostics. An ingest compares content plus a mode-specific dependency key: a hit
  is a no-op, a miss re-ingests and version-bumps the LS. Ingest is additive (`deleteFile`
  removes). `getProgram()` is reference-stable until a version bumps.
- **Dependency resolution** — by default `lexImports` finds specifiers (type-only
  included), resolved in parallel. Pre-resolved `SourceFileInfo.dependencies` (e.g. Gro's
  filer) skip both steps, trusted unchecked. Resolver cache identity is
  `ImportResolver.identity`; the default resolver is built lazily from the session's single
  tsconfig parse, and its host sees owned files and the in-flight batch.
- **Input order** — the same files ingested in any order or batching give identical output
  from a fresh session (limits under `postprocess.ts` above).
- **Context closure** (`contextClosure`, default `true`; `analyze()` passes `false`) — after
  each batch the session ingests, transitively, the in-root analyzable targets it doesn't
  own. They emit nothing and add no edges but stay version-tracked, which keeps
  `internal/` edits live and is the only way an unsupplied Svelte dependency gets a virtual
  (else its types are `any`). Each ingest call sets the role (`SetFileOptions.context`):
  inputs by default, so supplying a context file promotes it.
- **Deferred resolutions** — a specifier that resolved to nothing isn't final. Before the
  next lex+resolve batch after the owned set changes, the session calls the resolver's
  `invalidate()`; a `setFiles` that adds paths retries earlier null slots
  (`healUnresolvedEdges`).

## Data Model

`ModuleJson[]` → `DeclarationJson[]` → `MemberJson[]`; members never nest.

**ModuleJson** — `path` (relative to `sourceRoot`), `declarations`, `moduleComment` (the
module comment's prose), its tag fields `examples`, `deprecatedMessage`, `seeAlso`,
`since`, `internalMessage` (as on declarations), `dependencies`, `dependents`,
`starExports`, `reExports`, `externalReExports`, `externalStarExports`, `partial` (a
placeholder for a Svelte file whose transform threw).

**DeclarationJson** — `v.variant('kind', …)` over strict variants, narrowed with
`isKind(decl, 'function')`. `DeclarationKind`: `'type' | 'function' | 'variable' | 'class' |
'interface' | 'enum' | 'component' | 'snippet' | 'namespace'`. `MemberKind`:
`'function' | 'variable' | 'constructor'`.

**Shared fields** (all variants and members): `name`, `kind`, `docComment`,
`typeSignature`, `modifiers`, `sourceLine`, `genericParams`, `examples`,
`deprecatedMessage`, `internalMessage`, `seeAlso`, `throws`, `since`, `mutates`,
`partial`. Top-level only: `alsoExportedFrom`, `aliasOf`.

**Per-variant fields**:

- `function` — `parameters`, `returnType`, `returnTypeInfo`, `returnDescription`,
  `overloads`
- `variable` — `reactivity`, `typeInfo`, `defaultValue`
- `class` — `members`, `extends`, `implements`, `externalTypes`
- `interface` — `members`, `extends`, `externalTypes`, `mergedValue`
- `type` — `members`, `externalTypes`, `typeInfo`, `mergedValue`
- `enum` — `members`
- `component` — `props`, `externalTypes`, `acceptsChildren`, `lang`
- `snippet` — `parameters`
- `namespace` — `module`
- members: `function` — `parameters`, `returnType`, `returnTypeInfo`, `returnDescription`,
  `overloads`, `optional`, `defaultValue`; `variable` — `reactivity`, `typeInfo`,
  `optional`, `defaultValue`; `constructor` — `parameters`, `overloads`

`ComponentPropJson`, `ParameterJson`, and `TupleElementJson` carry `typeInfo`.
`ComponentPropJson` also carries `parameters` (snippets and callbacks),
`returnType`/`returnTypeInfo` (callbacks only), `description`, `defaultValue`, and the
shared doc fields (`docFields` in `types.ts`); `ParameterJson` carries none of `docFields`.
`OverloadJson` carries `returnTypeInfo`.

**Contracts that span fields** (full statements on the `types.ts` field docs):

- **Flat strings are the checker's rendering; structured fields are normalized.**
  `typeSignature` keeps the checker's text, truncation and member order included (for
  alias-lost types it isn't what editor hover shows). The one exception: the checker's
  optional-widening `undefined` is stripped from every member-type position so
  `optional: true` carries it alone. `null` and an `undefined`-only annotation are kept.
  Flat strings strip only at top level; trees strip at every optional position. Under
  `exactOptionalPropertyTypes`, property sites don't strip (`optionalWidened`); parameters
  and tuple elements always do. An omittable parameter's top-level `undefined` goes whether
  widened, written, or inferred (`b: T | undefined = x` → `T`).
- **`externalTypes`** (`typescript-extract-shared.ts`) — contributions from external
  packages are dropped by *declaration origin* at every granularity (named properties,
  index signatures, call/construct signatures, through intersections and utility
  wrappers); declaration-less contributions fail open. Dropped bags are labeled by an AST
  walk that descends through project-local names, so
  `interface Props extends HTMLButtonAttributes` and
  `type Props = HTMLButtonAttributes & {…}` record the same bag. Props the `$props()`
  destructuring names are admitted (`admitNames`), and their bag stays listed. Tests:
  `external-properties.test.ts`, `external-composition.test.ts`.
- **Type-alias `members`** — only for object-like shapes (`hasExtractableProperties`), not
  unions, tuples, or external generic references. Components filter unconditionally, so
  union prop types get `externalTypes` too.
- **Interface/class `externalTypes`** come from the heritage walk
  (`applyHeritageExternalTypes`); `extends`/`implements` stay verbatim own-clause text, and
  `extends` is always an array.
- **Class visibility** — public and protected in, `private` and `#` out, by one rule
  (`isPrivateMemberDeclaration`) for the class and any structural alias over it. Getters
  and setters merge by name.
- **`defaultValue`** — verbatim author text (initializer, `@default`, or a parameter's
  `@param [b=0]`), quotes included.
- **`sourceLine`** — synthesized aliases carry the local export specifier's line; Svelte
  `<script module>` lines are remapped to the original source.
- **Default slot** — `export default …`, `export {x as default}`, and
  `export {default} from './x'` carry `name === 'default'`. Renames out of the slot carry
  the new name plus `aliasOf: {module, name: 'default'}`. Svelte components use their
  filename-derived name.
- **Wire format** — arrays default to `[]`, flags to `false`. `compactReplacer` strips
  empties and `false` (except under `value`, so a literal `false` node survives); the
  parse helpers (`parseAnalyzeResult`, `parseModuleJson`, `parseDiagnostics`) restore them
  and are the stable, library-agnostic contract. Array defaults are factories
  (`() => []`), since valibot returns a non-function default as-is. String maps
  (`mutates`, `propertyDescriptions`) use a local `StringRecord`, since `v.record` drops
  `constructor` and `prototype` keys.

## Key Design Decisions

### Module Paths in Printed Type Text

The checker prints module objects as `typeof import("<absolute path>")`, which would leak
local paths. `normalizeModulePathsInTypes` (`analyze-core.ts`) rewrites each path: an
emitted module becomes its `ModuleJson.path` (usable as a lookup key), a package the tail
after the last `node_modules/`, anything else `relative(projectRoot, …)`. Only paths naming
a loaded file are rewritten, keys in `NON_TYPE_TEXT_KEYS` are skipped, and it runs as one
whole-output pass so a new printing site can't miss it.

### Diagnostic Collection

- **Envelope** — `AnalyzeResultJson` is `{modules, diagnostics}`, round-tripping through
  `JSON.stringify`/`parseAnalyzeResult`. Diagnostics accumulate without halting; a
  declaration or member whose extraction failed mid-flight carries `partial: true`.
- **`Diagnostic.file`** — project-root-relative (`../` for out-of-root). Producers emit the
  absolute id; `finalizeDiagnostics` remaps virtual positions to `.svelte` positions (an
  unmappable one drops line and column), then `normalizeDiagnosticPaths` relativizes `file`
  and scrubs `message`.
- **Severity** is fixed per kind: `transform_failed` and `module_unreadable` are errors,
  everything else a warning. `duplicate_declaration` emits only under `onDuplicates`
  (`'warn'` adds a log, `'throw'` a throw).
- **Lifecycles** — *ingest-time* kinds (`transform_failed`, `source_map_failed`,
  `import_parse_failed`, `resolver_failed`) come back from `setFile`/`setFiles` and persist
  on the entry (`allIngestDiagnostics()` is the cumulative view). *Query-time* kinds are
  recomputed every `query()`. *Discovery-time* `module_unreadable` comes from exports
  discovery only (glob discovery throws on an unreadable file) and is merged by
  `analyzeFromFiles`; session consumers own it, and the Vite plugin keeps it in a side
  channel.
- **`alias_lost`** — an exported alias the checker dropped and neither recovery channel
  heals. Gated on a registry being present, a loss-capable right-hand side, not a literal
  union or brand, and not `@nodocs`. The author-side fix is a nominal symbol
  (`interface Foo extends z.infer<typeof S> {}`).

### Re-Export Philosophy

The opt-in `findDuplicates` flags duplicate names by canonical identity after resolving
`aliasOf` chains; `@nodocs` exempts. Encodings (mechanics in `typescript-exports.ts` and
`postprocess.ts`):

- **Import-then-export** (`import {foo as bar} from './x'; export {bar}`, default and
  namespace imports, `export default X`) → encoded as its export-from twin: rename
  detection and the same-name walk step through import bindings (`nextExportHop`).
  `sourceLine` is the export's line. A package import exported again records nothing.
- **Same-name** → `alsoExportedFrom` on the canonical, plus `ModuleJson.reExports`
  (`{name, module, typeOnly, sourceLine}`) on the re-exporter. If the statement has its own
  JSDoc, an alias is *also* synthesized locally, so the local content has a home.
- **Renamed** → a synthesized declaration with `aliasOf`: a full re-analysis of the
  canonical, `sourceLine` at the local specifier.
- **Star** → `starExports` when the target emits a module; its bindings are never
  materialized. A star over a module that emits nothing is read as the named re-exports it
  stands for (`collectMaterializedStars`), with ES star semantics.
- **External** (the immediate target is a package) → `externalReExports` /
  `externalStarExports`, flat statement facts. Indirect chains leave no trace.
- **Non-emitted canonicals** (gated, a context file, a module left out of `exports`) → a
  full alias even for a same-name re-export, with `aliasOf.module` dangling by design and
  no `reExports` edge. The predicate is `ExtractContext.isEmittedFile`, not `isSource`, so
  no edge or `starExports` entry points at a module the output lacks.
- **Virtual-less components** (transform failed, or never supplied) → read by the path of
  a relative `.svelte` specifier (`ExtractContext.svelteFileStatus`), never through the
  `svelte` package's ambient `*.svelte` module, so unrelated files can't change the
  reading (`virtuallessSvelteReExport`). The default re-exports as a `partial` component
  and a namespace as a `partial` namespace — export-from, import-then-export, and
  `export default X`, directly or through other modules (taking a valid chain's edges
  and aliases). A star names the `partial` placeholder when it emits
  (`resolveExportSurface` reports it unresolved), else drops. A missing or out-of-root
  file documents nothing.
- **Namespace** (`export * as ns from './x'`) → `NamespaceDeclarationJson` whose `module`
  points at the projected source, detected via `ValueModule` before `analyzeDeclaration`
  (which would leak `typeof import(...)`).
- **Svelte component** re-exports → a `kind: 'component'` placeholder that phase-2
  `resolveComponentAliases` fills from the canonical (gaps only; gated canonicals supplied
  as lookup-only context). Re-exported `<script module>` functions and types analyze as
  what they are.

Statement-level `@nodocs` suppresses every encoding; one inside a typedef block
(`isTypedefBlock`) is the typedef's, so the statement keeps its encodings.
`resolveExportSurface` combines them into a module's full export surface with ES star
semantics and reports unresolvable stars instead of guessing. Lock-in tests:
`src/test/analyze.reexport-{edges,namespace,forward,gated,star,import}.test.ts` and
`postprocess.surface.test.ts`.

### Not Supported

- A same-name `@typedef {import('./a.js').A} A` documents as an alias over the import, as its
  TS twin `type A = import('./a.js').A` does, never as a re-export edge. A `@property` after a
  non-`@property` tag has left the typedef's property list and drops silently.
- An `@overload`'s `{...T}` parameter types as `T | undefined` (the checker's own reading;
  signature help prints `T[]`).
- Standalone `namespace Foo {}` documents as a bare `kind: 'variable'` (`export * as ns` is
  supported). Decorators aren't modeled.
- `@nodocs` on members and component props is ignored with no warning.
- Silently dropped: indirect external re-exports, unresolvable specifiers, the type-only
  marker of `export type * from` and of a renamed value (`export type {c as d} from`).
- A `<script module>` name re-exported from a component with no virtual documents as a
  bare `kind: 'variable'`.
- A virtual-less component re-exported through a non-relative specifier (a `paths` alias
  like `$lib/…`) still depends on the ambient `*.svelte` module: a bare `variable`, or an
  `externalReExports`/`externalStarExports` entry once another component has a virtual.
- `ParameterJson` deliberately has no doc fields, unlike `ComponentPropJson`.
- `</script >` (whitespace before `>`): Svelte and `findScriptTags` accept it, svelte2tsx
  doesn't, so a legacy component written that way documents no props and warns
  `svelte_prop_failed` per `export let`.
- A runes component's `<slot />` doesn't set `acceptsChildren`.
- Legacy components: named slots, slot props, and events aren't modeled. Two export forms
  follow svelte2tsx where it departs from Svelte: `export let a; export {a as b}` keeps
  only `b`, without the binding's JSDoc (TS reads it as optional, JS by the initializer),
  and an export clause above its binding loses the JSDoc (the type still resolves; in TS it
  reads as optional).

## API

`analyzeFromFiles()` (one-shot, discovers files from disk), `analyze()` (one-shot, you
supply `SourceFileInfo[]`), and `createAnalysisSession()` (incremental) all produce
`AnalyzeResultJson`. The CLI and the Vite virtual module emit it through
`compactReplacer`, so parse through `parseAnalyzeResult` to restore defaults. Consumers own
package metadata; see `LibraryJson` in `@fuzdev/fuz_util` for the fuz pattern.

### CLI

`npx svelte-docinfo [project-root]` writes compact JSON to stdout (`--pretty`,
`-o <file>`). The flag table is in `README.md` and `cli.ts`, whose help text interpolates
the defaults. `--only <glob>` filters output modules after full analysis; diagnostics
aren't filtered. Exit codes: 0 success, 1 analysis errors, 2 CLI errors or a thrown
analysis error.

### Ecosystem Integration

fuz_ui and fuz_css consume `virtual:svelte-docinfo` directly: a hand-written
`src/routes/library.ts` combines `modules` with `virtual:pkg.json` via fuz_util's
`library_json_from_modules()`, feeding fuz_ui's `Library`. See the fuz-stack skill's
`references/documentation-system.md`.

## Dependencies

- **Runtime**: `commander`, `tinyglobby`, `picomatch`, `@jridgewell/trace-mapping`, and
  `valibot` (the output schemas; a regular dependency, so consumers using the parse
  helpers never import it).
- **Peers** (required): `svelte` 5+ and `svelte2tsx` (eagerly imported by every entry, so
  needed even for TS-only analysis), and `typescript` 5.9+ or 6, so consumers don't carry
  a second TS.
- **Peers** (optional): `vite` 6+, for the Vite plugin only.
- **Not a dependency**: `zod`. Nothing under `src` imports it (a `types.test.ts` guard),
  and it doesn't resolve locally, so a fixture importing it would silently type as `any`;
  tests that need a real schema library use `valibot`.

## Testing

Tests live in `src/test/` and import source via `#lib/*.ts`. Fixtures
(`src/test/fixtures/{tsdoc,ts,svelte}/`) hold an input plus a generated `expected.json`:
**tsdoc** captures `parseComment` output; **ts** and **svelte** capture the module plus
diagnostics, each fixture run through `analyzeCore` alone. **Multi-file** fixtures
(siblings beside the entry) capture the whole envelope; `internal/` siblings exercise
gated canonicals, and the ts side's `external/` maps to `node_modules/`. Rules and guards:
`src/test/fixtures/CLAUDE.md`. Regenerate with `gro src/test/fixtures/update`, or one set
with `gro src/test/fixtures/ts/update`.

`examples.test.ts` runs the example scripts and needs `npm run build` and
`npm run setup-examples` first.

## Development

```bash
gro check     # typecheck, test, gen --check, format --check, lint
gro test      # run tests
gro gen       # run code generators
```

`vite.config.ts` imports the plugin from source (`./src/lib/vite.ts`), not the
`svelte-docinfo/vite.js` self-reference: Gro resolves the Vite config before building, so
a `dist/` import breaks `gro check` on a fresh checkout. Restart the dev server to pick up
`src/lib` changes. The examples exercise the packaged entry.

**Standards**: TypeScript strict mode, Svelte 5 runes, tabs, 100-char width, tests in
`src/test/` (not co-located), and real source extensions in imports (`.ts`, `.svelte`; the
build rewrites them to `.js` in `dist`).
